import { expect, test, type Page } from '@playwright/test';
import { closePractice, openPractice } from './helpers/practice.js';
import { expectOneRed } from './helpers/red.js';
import { redBars, redSettled, seekBar } from './helpers/seek.js';

/**
 * Note ids split into the engine's (`n` and a number, written into the MusicXML) and how many
 * others there are: Verovio draws a few notes the engine has no id for under ids of its own, new
 * for each engraving, and paper is engraved from its own text (the printed digits only, issue 94).
 */
function noteIdSplit(ids: string[]): { engine: string[]; others: number } {
  const engine = ids.filter((id) => /^n\d+$/.test(id)).sort();
  return { engine, others: ids.length - engine.length };
}

// Issue 99 (docs/research/ram-usage.md): on a piece of six pages or more only the pages near the
// screen are in the DOM. Every page stands as an empty SVG with its viewBox, so the scroll height
// never changes; everything that reads the pages (the cursor, a seek, the dimming of a hand, the
// digits of a hand size, print) brings in the pages it needs.
const LONG = 'bulk-beethovenlv-o79-lvb-sonate-79-1-lvb-sonate-79-1-ly'; // 2,075 notes
const SCHERZO = 'pdmx-scherzo-no-2-f-chopin-op-31-31793326';

const slots = (page: Page) => page.locator('.score-sheet > svg');

/** The pages (0-based) that have been built: those with something drawn in them. */
function built(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.score-sheet > svg')].flatMap((s, i) =>
      s.childElementCount > 0 ? [i] : [],
    ),
  );
}

/** The number of the first bar of each page. */
function firstBars(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.score-sheet > svg')].map((s) =>
      Number(s.getAttribute('data-first-bar')),
    ),
  );
}

async function open(page: Page, slug = LONG): Promise<number> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?audio=silent#/piece/${slug}`);
  await expect(page.locator('.score-sheet g.fing').first()).toBeAttached({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled();
  const total = await slots(page).count();
  expect(errors).toEqual([]);
  return total;
}

/** Opens a piece of at least six pages: the long sonata, or the Scherzo when it lays out shorter. */
async function openWindowed(page: Page): Promise<number> {
  let total = await open(page);
  if (total < 6) total = await open(page, SCHERZO);
  expect(total).toBeGreaterThanOrEqual(6);
  return total;
}

/**
 * What each page holds, read while the page is built: `muted` is the number of dimmed elements,
 * `digits` the `startid:text` of every digit. A windowed sheet is walked a window at a time (a page
 * is built within a window height of the screen), so every page has been built once; a sheet with
 * every page in the DOM (`whole`) is read as it stands. Walked again until two walks agree, as a
 * fingering that is still being patched in has not settled.
 */
async function pageContents(
  page: Page,
  what: 'muted' | 'digits',
  whole = false,
): Promise<Record<string, string>> {
  const walk = () =>
    page.evaluate(
      async ([what, whole]) => {
        const found: Record<string, string> = {};
        const readAll = () =>
          document.querySelectorAll('.score-sheet > svg').forEach((s, i) => {
            if (s.childElementCount === 0) return;
            found[i] =
              what === 'muted'
                ? String(s.querySelectorAll('.is-muted').length)
                : [...s.querySelectorAll('g.fing')]
                    .map((e) => `${e.getAttribute('data-startid')}:${e.textContent}`)
                    .join();
          });
        if (whole) {
          readAll();
          return found;
        }
        const height = document.documentElement.scrollHeight;
        for (let y = 0; y < height; y += window.innerHeight) {
          window.scrollTo({ top: y, behavior: 'instant' });
          await new Promise((resolve) => setTimeout(resolve, 100));
          readAll();
        }
        return found;
      },
      [what, whole] as const,
    );
  let previous = JSON.stringify(await walk());
  for (let tries = 0; tries < 10; tries++) {
    const now = JSON.stringify(await walk());
    if (now === previous) return JSON.parse(now) as Record<string, string>;
    previous = now;
  }
  throw new Error('the pages never settled');
}

/**
 * The same piece in a second page of the browser where every page is in the DOM at once: with
 * no IntersectionObserver the window builds the whole sheet, which is the reference the windowed
 * sheet is compared with.
 */
async function openWhole(page: Page, slug: string): Promise<Page> {
  const whole = await page.context().newPage();
  await whole.addInitScript(() => {
    Reflect.deleteProperty(window, 'IntersectionObserver');
  });
  await whole.goto(`/?audio=silent#/piece/${slug}`);
  await expect(whole.locator('.score-sheet g.fing').first()).toBeAttached({ timeout: 30_000 });
  await expect(whole.getByRole('button', { name: 'Play' })).toBeEnabled();
  // Every page is built: nothing is empty.
  expect(await built(whole)).toHaveLength(await slots(whole).count());
  return whole;
}

const slugOf = (page: Page): string => page.url().split('#/piece/')[1]!;

async function noCountIn(page: Page): Promise<void> {
  await openPractice(page);
  await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
  await closePractice(page);
}

/** Scrolls to `y`, and waits for the pages there to be drawn. */
async function scrollTo(page: Page, y: number): Promise<void> {
  await page.evaluate((y) => window.scrollTo(0, y), y);
  await page.waitForTimeout(300);
}

test('only the pages near the screen are built, and the page is as tall as before', async ({
  page,
}) => {
  const total = await openWindowed(page);
  await expectOneRed(page, 'a score opened');
  await expect.poll(async () => (await built(page)).length).toBeGreaterThan(0);
  expect((await built(page)).length).toBeLessThan(total);
  // The drawn pages are in the SVG namespace, whatever parsed them.
  expect(
    await page.evaluate(() =>
      [...document.querySelectorAll('.score-sheet > svg > *')].every(
        (el) => el.namespaceURI === 'http://www.w3.org/2000/svg',
      ),
    ),
  ).toBe(true);

  // Down the whole piece a viewport at a time: the height never changes, the pages that are
  // drawn stay a few, and every note is met on the way.
  const walk = await page.evaluate(async () => {
    const height = document.documentElement.scrollHeight;
    const notes = new Set<string>();
    let drift = 0;
    let most = 0;
    for (let y = 0; y < height; y += window.innerHeight / 2) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 150));
      drift = Math.max(drift, Math.abs(document.documentElement.scrollHeight - height));
      const pages = [...document.querySelectorAll('.score-sheet > svg')].filter(
        (s) => s.childElementCount > 0,
      );
      most = Math.max(most, pages.length);
      for (const note of document.querySelectorAll('.score-sheet g.note')) notes.add(note.id);
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
    return { drift, most, notes: [...notes] };
  });
  expect(walk.drift).toBeLessThanOrEqual(1);
  expect(walk.most).toBeLessThan(total);
  expect(walk.notes.length).toBeGreaterThan(1000);
  await expect.poll(async () => (await built(page)).includes(total - 1)).toBe(true);
  await expect.poll(async () => (await built(page)).includes(0)).toBe(false);
  await expect(slots(page).first()).toHaveJSProperty('childElementCount', 0);
  // An empty page keeps its box.
  expect(await slots(page).first().getAttribute('viewBox')).toMatch(/^0 0 \d+ \d+$/);
  await scrollTo(page, 0);
  await expect.poll(async () => (await built(page)).includes(0)).toBe(true);
  await expect.poll(async () => (await built(page)).includes(total - 1)).toBe(false);
  await expectOneRed(page, 'scrolled to the end and back');
});

test('a seek far away by key brings its page in, and the red is in view', async ({ page }) => {
  await openWindowed(page);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  for (let i = 0; i < 10; i++) await page.keyboard.press('Shift+ArrowRight');
  await redSettled(page);
  await expect.poll(() => redBars(page)).toEqual([40]);
  await expect(page.locator('.score-sheet .is-red').first()).toBeInViewport();
  await expectOneRed(page, 'ten leaps on');
  // The page of the red is built; the first page, far away, is not.
  const pages = await built(page);
  const firsts = await firstBars(page);
  const redPage = firsts.filter((f) => f <= 40).length - 1;
  expect(pages).toContain(redPage);
  await page.keyboard.press('Home');
  await redSettled(page);
  await expect(page.getByRole('button', { name: 'Play' })).toHaveClass(/is-red/);
  expect(await redBars(page)).toEqual([]);
});

test('a click on a bar of the last page seeks there', async ({ page, isMobile }) => {
  const total = await openWindowed(page);
  const firsts = await firstBars(page);
  const last = firsts[total - 1]!;
  expect(await built(page)).not.toContain(total - 1);
  await seekBar(page, last, isMobile);
  await redSettled(page);
  await expect.poll(() => redBars(page)).toEqual([last]);
  await expect(
    slots(page)
      .nth(total - 1)
      .locator('.is-red')
      .first(),
  ).toBeAttached();
  await expectOneRed(page, 'cued on the last page');
});

test('playing across a page boundary carries the red onto the next page', async ({ page }) => {
  await openWindowed(page);
  await noCountIn(page);
  const firsts = await firstBars(page);
  await seekBar(page, firsts[2]! - 1); // the last bar of the second page
  await redSettled(page);
  await expect.poll(() => redBars(page)).toEqual([firsts[2]! - 1]);
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(slots(page).nth(2).locator('.is-red').first()).toBeAttached({ timeout: 20_000 });
  await expectOneRed(page, 'playing on page 3');
  await page.getByRole('button', { name: 'Pause' }).click();
  // Where the red stops depends on how long it played: a slow runner can reach the exposition's
  // repeat and be back on the first page by the pause. So the test reads the page holding it.
  const redPage = await page.evaluate(() =>
    [...document.querySelectorAll('.score-sheet > svg')].findIndex(
      (s) => s.querySelector('.is-red') !== null,
    ),
  );
  expect(redPage).toBeGreaterThanOrEqual(0);
  // Far down the piece, the page the red left (the second) is beyond two window heights and goes,
  // while the page holding the red stays.
  await scrollTo(page, await page.evaluate(() => document.documentElement.scrollHeight));
  if (redPage !== 1) await expect.poll(async () => (await built(page)).includes(1)).toBe(false);
  expect(await built(page)).toContain(redPage);
  expect((await redBars(page)).length).toBeGreaterThan(0);
});

test('a hand switched while playing dims every page built afterwards, the same as before', async ({
  page,
}) => {
  test.slow(); // the sheet is walked twice, and the same piece opened whole
  const total = await openWindowed(page);
  await noCountIn(page);
  await page.getByRole('button', { name: 'Play' }).click();
  await expect
    .poll(async () => (await redBars(page)).length, { timeout: 10_000 })
    .toBeGreaterThan(0);
  await openPractice(page);
  await page.evaluate(() =>
    document.querySelector<HTMLInputElement>('input[name="hands"][value="L"]')!.click(),
  );
  await expect.poll(() => page.locator('.score-sheet .is-muted').count()).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause' }).click();
  await expectOneRed(page, 'a hand left out');

  /** For each built page, how many elements it has dimmed. */
  const dimmed = (): Promise<Record<string, number>> =>
    page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll('.score-sheet > svg')]
          .map((s, i) => [i, s.childElementCount > 0 ? s.querySelectorAll('.is-muted').length : -1])
          .filter(([, n]) => (n as number) >= 0),
      ),
    );
  const seen: Record<string, number> = {};
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 700) {
    await scrollTo(page, y);
    for (const [i, n] of Object.entries(await dimmed())) {
      expect(n, `elements dimmed on page ${i} at ${y}`).toBeGreaterThan(0);
      // A page built again after it went is dimmed exactly as it was.
      if (seen[i] !== undefined) expect(n).toBe(seen[i]);
      seen[i] = n;
    }
  }
  expect(Object.keys(seen).length).toBe(total);
  await scrollTo(page, 0);
  for (const [i, n] of Object.entries(await dimmed())) expect(n).toBe(seen[i]);
  // Compared with the same piece and hand with every page built at once: page by page the same
  // elements are dimmed.
  const whole = await openWhole(page, slugOf(page));
  await openPractice(whole);
  await whole.evaluate(() =>
    document.querySelector<HTMLInputElement>('input[name="hands"][value="L"]')!.click(),
  );
  await expect.poll(() => whole.locator('.score-sheet .is-muted').count()).toBeGreaterThan(0);
  const reference = await pageContents(whole, 'muted', true);
  expect(Object.keys(reference)).toHaveLength(total);
  expect(await pageContents(page, 'muted')).toEqual(reference);
  await whole.close();
  // Back to both hands: nothing stays dimmed.
  await page.evaluate(() =>
    document.querySelector<HTMLInputElement>('input[name="hands"][value="both"]')!.click(),
  );
  await expect(page.locator('.score-sheet .is-muted')).toHaveCount(0);
  await scrollTo(page, height / 2);
  await expect(page.locator('.score-sheet .is-muted')).toHaveCount(0);
});

test('a hand size patches the digits of the pages built, and a page built again keeps them', async ({
  page,
}) => {
  test.slow(); // the sheet is walked twice, and the same piece opened whole
  await openWindowed(page);
  const digits = (index: number) =>
    slots(page)
      .nth(index)
      .locator('g.fing')
      .evaluateAll((els) =>
        els.map((e) => `${e.getAttribute('data-startid')}:${e.textContent}`).join(),
      );
  const before = await digits(0);
  expect(before).not.toBe('');
  await page.getByLabel('Hand size').selectOption('child');
  await expect.poll(() => digits(0), { timeout: 30_000 }).not.toBe(before);
  const patched = await digits(0);
  await expectOneRed(page, 'a hand size');
  // The page goes and comes back: the same digits.
  await scrollTo(page, await page.evaluate(() => document.documentElement.scrollHeight));
  await expect.poll(async () => (await built(page)).includes(0)).toBe(false);
  await scrollTo(page, 0);
  await expect.poll(async () => (await built(page)).includes(0)).toBe(true);
  expect(await digits(0)).toBe(patched);
  // Compared with the same piece and hand size with every page built at once: page by page the
  // same digits.
  const whole = await openWhole(page, slugOf(page));
  await expect(whole.getByLabel('Hand size')).toHaveValue('child');
  const reference = await pageContents(whole, 'digits', true);
  expect(Object.keys(reference).length).toBeGreaterThanOrEqual(6);
  expect(await pageContents(page, 'digits')).toEqual(reference);
  await whole.close();
  // A fresh open at that hand size is fingered the same.
  await page.reload();
  await expect(page.locator('.score-sheet g.fing').first()).toBeAttached({ timeout: 30_000 });
  await expect(page.getByLabel('Hand size')).toHaveValue('child');
  expect(await digits(0)).toBe(patched);
});

test('print draws every note of the piece, whichever pages are in the DOM', async ({ page }) => {
  await openWindowed(page);
  // Every note, met by walking the sheet.
  const notes = await page.evaluate(async () => {
    const ids = new Set<string>();
    for (let y = 0; y < document.documentElement.scrollHeight; y += window.innerHeight / 2) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 150));
      for (const note of document.querySelectorAll('.score-sheet g.note')) ids.add(note.id);
    }
    window.scrollTo(0, 0);
    return [...ids].sort();
  });
  // The digits the engine printed for the edition (issue 94): the paper holds exactly these.
  const edition = await page.evaluate(() =>
    [
      ...(
        window as unknown as { __digitus2Edition: { printed(): string[] } }
      ).__digitus2Edition.printed(),
    ].sort(),
  );
  expect(edition.length).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeEnabled({
    timeout: 30_000,
  });
  await page.evaluate(() => {
    const original = window.matchMedia.bind(window);
    const printMedia = new EventTarget() as MediaQueryList;
    Object.defineProperty(printMedia, 'matches', { value: true });
    window.matchMedia = (query) => (query === 'print' ? printMedia : original(query));
    window.print = () => {
      document.body.dataset.printCalled = 'true';
    };
  });
  await page.getByRole('button', { name: 'Print', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-print-called', 'true', {
    timeout: 60_000,
  });
  await page.emulateMedia({ media: 'print' });
  // The sheet is hidden for print and has no boxes: the window leaves its pages as they are
  // instead of taking every page for one in view.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  expect((await built(page)).length).toBeLessThan(await slots(page).count());
  const printed = await page
    .locator('.print-score g.note')
    .evaluateAll((els) => els.map((e) => e.id).sort());
  expect(printed.length).toBeGreaterThan(1000);
  expect(noteIdSplit(printed)).toEqual(noteIdSplit(notes));
  const paperDigits = await page
    .locator('.print-score g.fing')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-startid')!.replace(/^#/, '')).sort());
  expect(paperDigits).toEqual(edition);
  await page.emulateMedia({ media: 'screen' });
});
