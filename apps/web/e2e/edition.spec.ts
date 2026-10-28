import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { embellishDecided, openPractice } from './helpers/practice.js';
import { expectOneRed } from './helpers/red.js';
import { barPoint, redBars, redSettled, seekBar } from './helpers/seek.js';

// Issue 94: at rest the score prints the edition's digits (about as many as a teaching edition,
// never more than the editor prints); the bar being played, the bar a click cued and the bar under
// a mouse pointer show every digit. The digits left out stay in the SVG (class `is-spare`, hidden
// by fill opacity outside an open bar), so a re-solve or a hand switch has nothing to add or flash.

interface Manifest {
  slug: string;
  editorDigits?: number;
}
const manifest = JSON.parse(
  readFileSync(new URL('../../../content/manifest.json', import.meta.url), 'utf8'),
) as Manifest[];
const editorDigits = (slug: string) => manifest.find((p) => p.slug === slug)?.editorDigits;

const TWINKLE = 'twinkle-twinkle-little-star';
const ARABESQUE = 'burgmuller-op100-no2-arabesque';

// One piece per level 1 to 5 (the core30 set): Twinkle has no editor's fingering to cap it.
const LEVELS: ReadonlyArray<[number, string]> = [
  [1, TWINKLE],
  [2, 'schumann-op68-no1-melody'],
  [3, ARABESQUE],
  [4, 'mozart-sonata-k545-mvt1'],
  [5, 'beethoven-moonlight-sonata-mvt1'],
];

test.beforeEach(({ isMobile }) => {
  test.skip(isMobile, 'the edition is checked at desktop width');
});

async function open(page: Page, slug: string): Promise<void> {
  await page.goto(`/?audio=silent#/piece/${slug}`);
  await expect(page.locator('.score-sheet g.fing').first()).toBeAttached({ timeout: 30_000 });
  await page.waitForFunction(
    () =>
      (
        window as unknown as { __digitus2Edition?: { printed(): unknown } }
      ).__digitus2Edition?.printed() != null,
    undefined,
    { timeout: 30_000 },
  );
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled({ timeout: 30_000 });
  // The pointer rests off the music: no bar is hovered.
  await page.mouse.move(2, 2);
}

/** The printed notes the worker answered, and the digits of every page of the piece, built. */
async function census(page: Page) {
  return page.evaluate(() => {
    const hook = (
      window as unknown as { __digitus2Edition: { printed(): string[]; buildAll(): void } }
    ).__digitus2Edition;
    hook.buildAll();
    const fings = [...document.querySelectorAll('.score-sheet g.fing')];
    const id = (el: Element) => el.getAttribute('data-startid')!.replace(/^#/, '');
    const open = document.querySelectorAll('.score-sheet g.measure.is-open').length;
    const visible = fings.filter((f) => getComputedStyle(f).fillOpacity !== '0');
    return {
      printed: hook.printed(),
      all: fings.length,
      notes: document.querySelectorAll('.score-sheet g.note').length,
      allIds: fings.map(id),
      visibleIds: visible.map(id),
      unspareIds: fings.filter((f) => !f.classList.contains('is-spare')).map(id),
      open,
    };
  });
}

for (const [level, slug] of LEVELS) {
  test(`level ${level} (${slug}) prints the edition at rest and keeps every digit in the SVG`, async ({
    page,
  }, testInfo) => {
    await open(page, slug);
    const c = await census(page);
    expect(c.open, 'no bar is open at rest').toBe(0);
    const printed = new Set(c.printed);
    expect(c.printed.length).toBeGreaterThan(0);
    // The digits drawn at rest are exactly the printed ones.
    expect(c.visibleIds.length).toBe(c.printed.length);
    expect(new Set(c.visibleIds)).toEqual(printed);
    expect(new Set(c.unspareIds)).toEqual(printed);
    // Every note keeps its g.fing: the edition hides digits, it never drops them.
    // (A tied note has no digit of its own, so the count can sit a few under the notes.)
    expect(c.all).toBeLessThanOrEqual(c.notes);
    expect(c.all).toBeGreaterThanOrEqual(Math.floor(c.notes * 0.97));
    expect(c.all).toBeGreaterThan(c.printed.length);
    for (const id of printed) expect(c.allIds).toContain(id);
    const cap = editorDigits(slug);
    if (cap !== undefined) expect(c.printed.length).toBeLessThanOrEqual(cap);
    testInfo.annotations.push({
      type: 'digits',
      description: `printed ${c.printed.length} of ${c.all} notes; editor ${cap ?? 'none'}`,
    });
    console.log(
      `level ${level} ${slug}: printed ${c.printed.length}, notes ${c.all}, editorDigits ${cap ?? '-'}`,
    );
  });
}

/** The digits of bar `bar` (0-based, the score's bar order) with their computed fill opacity. */
function barDigits(page: Page, bar: number): Promise<string[]> {
  return page.evaluate((bar) => {
    const m = document.querySelectorAll('.score-sheet g.measure')[bar]!;
    return [...m.querySelectorAll('g.fing')].map((f) => getComputedStyle(f).fillOpacity);
  }, bar);
}

const allShown = async (page: Page, bar: number) => {
  const d = await barDigits(page, bar);
  return d.length > 0 && d.every((o) => o === '1');
};

test('hovering a bar shows every digit in it, and leaving puts the edition back', async ({
  page,
}) => {
  await open(page, TWINKLE);
  await expectOneRed(page, 'at rest');
  const before = await barDigits(page, 1);
  expect(
    before.some((o) => o === '0'),
    'bar 2 has spare digits at rest',
  ).toBe(true);
  const { x, y } = await barPoint(page, 1);
  await page.mouse.move(x, y);
  await expect.poll(() => allShown(page, 1)).toBe(true);
  await expectOneRed(page, 'hovering');
  // The bar next to it stays as printed.
  expect((await barDigits(page, 3)).some((o) => o === '0')).toBe(true);
  await page.mouse.move(2, 2);
  await expect.poll(async () => (await barDigits(page, 1)).join(',')).toBe(before.join(','));
  await expect(page.locator('.score-sheet .is-closing')).toHaveCount(0);
});

test('a click cues a bar and opens it; Play opens the cursor, and the bar before it returns to the edition', async ({
  page,
}) => {
  await open(page, TWINKLE);
  await embellishDecided(page, 'offered');
  await openPractice(page);
  await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
  await seekBar(page, 1);
  await page.mouse.move(2, 2);
  await redSettled(page);
  expect(await redBars(page)).toEqual([1]);
  await expectOneRed(page, 'cued');
  await expect.poll(() => allShown(page, 1)).toBe(true);
  expect((await barDigits(page, 0)).some((o) => o === '0')).toBe(true);
  expect((await barDigits(page, 3)).some((o) => o === '0')).toBe(true);

  // Played, the cursor's bar shows all its digits and so does the next one; the bars left behind
  // return to the edition.
  await page.getByRole('button', { name: 'Play' }).click();
  await expect
    .poll(async () => (await redBars(page))[0] ?? -1, { timeout: 30_000 })
    .toBeGreaterThan(2);
  await expectOneRed(page, 'playing');
  // The red's bar and the open bars are read together, in one task: the cursor moves on between
  // two calls. The bars left behind have returned to the edition; the cursor's is open.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const bars = [...document.querySelectorAll('.score-sheet g.measure')];
          const red = document.querySelector('.score-sheet .is-red')?.closest('g.measure');
          const at = red ? bars.indexOf(red) : -1;
          const opened = bars.flatMap((m, i) => (m.classList.contains('is-open') ? [i] : []));
          return at > 2 && opened.includes(at) && opened.every((i) => i >= at && i <= at + 1);
        }),
      { timeout: 30_000 },
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Pause' }).click();
  await redSettled(page);
  const paused = (await redBars(page))[0]!;
  await expect.poll(() => allShown(page, paused)).toBe(true);
  await expectOneRed(page, 'paused');
});

test('a re-solve at another hand size starts no transition on a digit outside an open bar', async ({
  page,
}) => {
  await open(page, ARABESQUE);
  const before = await census(page);
  await page.evaluate(() => {
    const w = window as unknown as { __runs: number };
    w.__runs = 0;
    document.addEventListener(
      'transitionrun',
      (e) => {
        const t = e.target as Element;
        if (t.matches?.('g.fing') && !t.closest('g.measure.is-open, g.measure.is-closing'))
          w.__runs++;
      },
      true,
    );
  });
  await page.getByLabel('Hand size').selectOption('child');
  await expect(page.getByLabel('Hand size')).toHaveValue('child');
  // The new fingering has been solved and shown: the printed set is the child's.
  await expect
    .poll(async () => (await census(page)).printed.join(','), { timeout: 20_000 })
    .not.toBe(before.printed.join(','));
  const after = await census(page);
  expect(after.visibleIds.length).toBe(after.printed.length);
  expect(after.all).toBe(before.all);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { __runs: number }).__runs)).toBe(0);
});

test('a hand switch never shows a digit the edition leaves out, outside an open bar', async ({
  page,
}) => {
  await open(page, ARABESQUE);
  await openPractice(page);
  await embellishDecided(page);
  for (const hands of ['L', 'R', 'both'] as const) {
    const seen = await page.evaluate(async (hands) => {
      let max = 0;
      let frames = 0;
      let swept = 0;
      const sample = () => {
        frames++;
        swept = Math.max(swept, document.querySelectorAll('.score-sheet .is-sweeping').length);
        for (const f of document.querySelectorAll(
          '.score-sheet g.measure:not(.is-open) g.fing.is-spare',
        )) {
          max = Math.max(max, parseFloat(getComputedStyle(f).fillOpacity));
        }
      };
      document.querySelector<HTMLInputElement>(`input[name="hands"][value="${hands}"]`)!.click();
      const end = performance.now() + 900;
      while (performance.now() < end) {
        sample();
        await new Promise((r) => requestAnimationFrame(r));
      }
      return { max, frames, swept };
    }, hands);
    expect(seen.frames).toBeGreaterThan(5);
    expect(seen.swept, `the sweep ran (${hands})`).toBeGreaterThan(0);
    expect(seen.max, `spare digits stayed hidden (${hands})`).toBe(0);
  }
  await expectOneRed(page, 'after the switches');
});

test('reduced motion: a digit revealed has no transition and no bar is ever closing', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, TWINKLE);
  await page.evaluate(() => {
    const w = window as unknown as { __closing: number };
    w.__closing = 0;
    new MutationObserver((records) => {
      for (const r of records) {
        if ((r.target as Element).classList.contains('is-closing')) w.__closing++;
      }
    }).observe(document.querySelector('.score-sheet')!, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  });
  for (const bar of [1, 2]) {
    const { x, y } = await barPoint(page, bar);
    await page.mouse.move(x, y);
    await expect.poll(() => allShown(page, bar)).toBe(true);
    const durations = await page.evaluate((bar) => {
      const m = document.querySelectorAll('.score-sheet g.measure')[bar]!;
      return [...m.querySelectorAll('g.fing.is-spare')].map(
        (f) => getComputedStyle(f).transitionDuration,
      );
    }, bar);
    expect(durations.length).toBeGreaterThan(0);
    expect(new Set(durations)).toEqual(new Set(['0s']));
  }
  await page.mouse.move(2, 2);
  await expect.poll(async () => (await barDigits(page, 2)).some((o) => o === '0')).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __closing: number }).__closing)).toBe(0);
});

test('no translucent group holds a transformed shape after a reveal (issue 79)', async ({
  page,
}) => {
  await open(page, ARABESQUE);
  await openPractice(page);
  await embellishDecided(page);
  const { x, y } = await barPoint(page, 2);
  await page.mouse.move(x, y);
  await expect.poll(() => allShown(page, 2)).toBe(true);
  await page.evaluate(() =>
    document.querySelector<HTMLInputElement>('input[name="hands"][value="L"]')!.click(),
  );
  await expect(page.locator('.score-sheet .is-sweeping')).toHaveCount(0, { timeout: 5_000 });
  const groups = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll('.score-sheet svg *')) {
      const cs = getComputedStyle(el);
      const translucent = parseFloat(cs.opacity) < 1 || cs.filter !== 'none';
      if (translucent && (el.hasAttribute('transform') || el.querySelector('use, [transform]'))) {
        out.push(`${el.tagName}.${el.getAttribute('class') ?? ''}#${el.id}`);
      }
    }
    return out;
  });
  expect(groups).toEqual([]);
});

// The paper shows the edition: the print root engraves only the printed digits, no gaps.
for (const via of ['the button', 'Ctrl+P'] as const) {
  test(`print (${via}) holds exactly the printed digits`, async ({ page }) => {
    await open(page, TWINKLE);
    const { printed, notes } = await census(page);
    await page.evaluate(() => {
      const original = window.matchMedia.bind(window);
      const printMedia = new EventTarget() as MediaQueryList;
      Object.defineProperty(printMedia, 'matches', { value: true });
      window.matchMedia = (query) => (query === 'print' ? printMedia : original(query));
      window.print = () => {
        document.body.dataset.printCalled = 'true';
      };
    });
    if (via === 'Ctrl+P') await page.keyboard.press('Control+p');
    else await page.getByRole('button', { name: 'Print', exact: true }).click();
    await expect(page.locator('body')).toHaveAttribute('data-print-called', 'true', {
      timeout: 30_000,
    });
    await page.emulateMedia({ media: 'print' });
    const ids = await page
      .locator('.print-score g.fing')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-startid')!.replace(/^#/, '')));
    expect(ids.length).toBe(printed.length);
    expect(new Set(ids)).toEqual(new Set(printed));
    expect(await page.locator('.print-score g.note').count()).toBe(notes);
  });
}
