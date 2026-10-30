import { expect, test, type Locator, type Page } from '@playwright/test';
import { openLibraryPiece, libraryReady } from './helpers/library.js';
import { fakeMidi, installFakeMidi } from './helpers/midi.js';
import { horizontalOverflow } from './helpers/overflow.js';
import { embellishDecided } from './helpers/practice.js';
import { expectOneRed } from './helpers/red.js';

// The Practice panel on a phone (issue 244): below 480 px the panel is capped so the layout's
// tallest system still fits above the dock and what does not fit scrolls inside it, and opening
// it brings the reader's system above the dock when the dock would cover it. A piano connected
// gives the panel its most controls (Practice mode, Hands, Hear the other hand). The e2e phone
// project is 360 x 740; the issue was seen at 375 x 812. This spec is not in the mobile project's
// list: it runs in the desktop project (Chromium) and in the iphone project (WebKit, the engine
// of an iPhone), each describe with its own phone viewport. The panel is opened and closed with
// a tap at the toggle's coordinates: a locator's click scrolls the page in WebKit before it
// clicks, which would move the reader's system by itself.

const MINUET = 'bach-minuet-g-major-bwv-anh-114';
const TWINKLE = 'twinkle-twinkle-little-star';
const OP13 = 'beethoven-sonata-op13-mvt2';
/** A long piece whose pages are built as the reader comes to them (the page window). */
const K545 = 'mozart-sonata-k545-mvt1';
/** The air kept above a system (`SYSTEM_TOP_MARGIN`, useCursor.ts). */
const MARGIN = 12;

/** The page has stopped scrolling (five frames at one position), so boxes can be read. */
function settle(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let last = -1;
        let still = 0;
        const tick = () => {
          still = window.scrollY === last ? still + 1 : 0;
          last = window.scrollY;
          if (still >= 5) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

interface Geometry {
  innerHeight: number;
  dockTop: number;
  dockBottom: number;
  dockHeight: number;
  /** The reader's system: the red notes' system, else the first at or below the window's top. */
  reader: { top: number; bottom: number } | null;
  tallest: number;
  scrollY: number;
}

async function geometry(page: Page): Promise<Geometry> {
  await settle(page);
  return page.evaluate(() => {
    const dock = document.querySelector('.dock')!.getBoundingClientRect();
    const systems = Array.from(document.querySelectorAll('.score-sheet g.system'));
    const rects = systems.map((s) => s.getBoundingClientRect());
    const marked = document.querySelector('.score-sheet .is-red')?.closest('g.system') ?? null;
    const rect = marked ? marked.getBoundingClientRect() : rects.find((r) => r.top >= 0);
    return {
      innerHeight: window.innerHeight,
      dockTop: dock.top,
      dockBottom: dock.bottom,
      dockHeight: dock.height,
      reader: rect ? { top: rect.top, bottom: rect.bottom } : null,
      tallest: Math.max(0, ...rects.map((r) => r.height)),
      scrollY: window.scrollY,
    };
  });
}

/** Taps the Practice toggle where it stands, without scrolling the page first. */
async function tapPractice(page: Page, expanded: boolean): Promise<void> {
  const toggle = page.locator('.dock .practice-toggle');
  if ((await toggle.getAttribute('aria-expanded')) === String(expanded)) return;
  const box = (await toggle.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(toggle).toHaveAttribute('aria-expanded', String(expanded));
}
const openPractice = (page: Page) => tapPractice(page, true);
const closePractice = (page: Page) => tapPractice(page, false);

/** The control stands whole inside the Practice panel's box. */
async function wholeInPanel(page: Page, target: Locator): Promise<boolean> {
  const box = (await target.boundingBox())!;
  const panel = (await page.locator('.practice-panel').boundingBox())!;
  return box.y >= panel.y - 0.5 && box.y + box.height <= panel.y + panel.height + 0.5;
}

/** Opens `slug` with the walk's piano connected (or none), the right hand chosen with one. */
async function open(page: Page, slug: string, piano: boolean, hands = 'R'): Promise<void> {
  if (piano) {
    await installFakeMidi(page, { permission: 'granted', playAlong: true, settings: { hands } });
  }
  await page.goto(`/?audio=silent#/piece/${slug}`);
  await expect(page.locator('.score-sheet g.fing').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.dock .practice-toggle')).toBeVisible();
  if (piano) {
    await embellishDecided(page);
    await fakeMidi(page).waitForStep();
  }
}

for (const [width, height] of [
  [360, 740],
  [375, 812],
] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`Practice open at ${width} x ${height}, ${scheme}`, () => {
      test.use({
        viewport: { width, height },
        isMobile: true,
        hasTouch: true,
        colorScheme: scheme,
      });

      for (const piano of [false, true]) {
        test(`a whole system stays above the dock, ${piano ? 'with' : 'without'} a piano`, async ({
          page,
        }, testInfo) => {
          await open(page, MINUET, piano);
          await openPractice(page);

          const g = await geometry(page);
          const label = JSON.stringify(g);
          expect(g.reader, label).not.toBeNull();
          expect(g.reader!.top, label).toBeGreaterThanOrEqual(0);
          expect(g.reader!.bottom, label).toBeLessThanOrEqual(g.dockTop + 0.5);
          expect(g.dockBottom, label).toBeLessThanOrEqual(g.innerHeight + 0.5);
          if (piano) {
            await expect(page.getByText('Practice mode')).toBeVisible();
            await expect(page.getByRole('switch', { name: 'Hear the left hand' })).toBeVisible();
          }
          expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
          await expectOneRed(page, 'Practice open');
          // "Add notes between" is decided a moment after the score is ready and adds a row to
          // the panel: the system placed for the open panel is above the dock after it too.
          await embellishDecided(page);
          const later = await geometry(page);
          expect(later.reader!.top, JSON.stringify(later)).toBeGreaterThanOrEqual(0);
          expect(later.reader!.bottom, JSON.stringify(later)).toBeLessThanOrEqual(
            later.dockTop + 0.5,
          );
          await testInfo.attach('open', {
            body: await page.screenshot(),
            contentType: 'image/png',
          });

          // The fullest panel: the loop fields as well. The panel keeps room above the dock for
          // the tallest system, and its own content scrolls.
          const loop = page.getByRole('checkbox', { name: 'Loop bars' });
          await loop.check();
          const full = await geometry(page);
          const at = JSON.stringify(full);
          expect(full.innerHeight - full.dockHeight, at).toBeGreaterThanOrEqual(
            full.tallest + MARGIN - 0.5,
          );
          expect(full.dockBottom, at).toBeLessThanOrEqual(full.innerHeight + 0.5);
          expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
          await expectOneRed(page, 'Practice open with a loop');
          await testInfo.attach('loop', {
            body: await page.screenshot(),
            contentType: 'image/png',
          });
        });
      }
    });
  }
}

test.describe('a piece with tall systems (Op. 13) at 360 x 740', () => {
  test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });

  test('the panel scrolls inside its cap, opens at its top and keeps its place when a row arrives', async ({
    page,
  }) => {
    await open(page, OP13, true, 'both');
    await openPractice(page);

    const opened = await geometry(page);
    expect(opened.reader, JSON.stringify(opened)).not.toBeNull();
    expect(opened.reader!.top).toBeGreaterThanOrEqual(0);
    expect(opened.reader!.bottom).toBeLessThanOrEqual(opened.dockTop + 0.5);

    const panel = page.locator('.practice-panel');
    const hands = page.getByRole('group', { name: 'Hands' });
    const practiceMode = panel.locator('label', { hasText: 'Practice mode' });
    const tempo = panel.locator('.tempo');
    const state = () =>
      panel.evaluate((el) => ({
        scrollTop: el.scrollTop,
        overflow: el.scrollHeight - el.clientHeight,
        above: el.hasAttribute('data-above'),
        below: el.hasAttribute('data-below'),
        shadow: getComputedStyle(el).boxShadow,
      }));

    // It opens at its top: Practice mode and Tempo first.
    await settle(page);
    const top = await state();
    expect(top.scrollTop, JSON.stringify(top)).toBe(0);
    expect(top.above, JSON.stringify(top)).toBe(false);
    expect(await wholeInPanel(page, practiceMode)).toBe(true);
    expect(await wholeInPanel(page, tempo)).toBe(true);

    // A row arrives above Hands while the panel is at its top: Practice mode and Tempo stay in the
    // box and Hands, the control just used, stands whole in it.
    /** The head's distance from the panel's top edge: the page may scroll, the panel's rows may not. */
    const headAt = async () =>
      (await practiceMode.boundingBox())!.y - (await panel.boundingBox())!.y;
    const headBefore = await headAt();
    await page.getByRole('radio', { name: 'Right hand' }).check();
    await expect(page.getByRole('switch', { name: 'Hear the left hand' })).toBeVisible();
    await settle(page);
    // Everything fits: nothing scrolls, the head stays where it was.
    const headAfter = await headAt();
    expect(headAfter, 'the head stays').toBeCloseTo(headBefore, 0);
    expect(await wholeInPanel(page, practiceMode)).toBe(true);
    expect(await wholeInPanel(page, tempo)).toBe(true);
    expect(await wholeInPanel(page, hands)).toBe(true);
    // The row made the panel scroll, and the lower edge says the rows below it go on.
    const grown = await state();
    expect(grown.overflow, JSON.stringify(grown)).toBeGreaterThan(0);
    expect(grown.above, JSON.stringify(grown)).toBe(false);
    expect(grown.below, JSON.stringify(grown)).toBe(true);

    const full = await geometry(page);
    expect(full.innerHeight - full.dockHeight).toBeGreaterThanOrEqual(full.tallest + MARGIN - 0.5);

    // Closed and opened again, it opens at its top: Practice mode and Tempo first.
    await closePractice(page);
    await openPractice(page);
    await settle(page);
    expect((await state()).scrollTop).toBe(0);
    expect(await wholeInPanel(page, practiceMode)).toBe(true);
    expect(await wholeInPanel(page, tempo)).toBe(true);

    // From Play back through every control: each one comes into the panel's box and the page
    // does not scroll.
    await page.locator('.dock .play-button').focus();
    const y0 = await page.evaluate(() => window.scrollY);
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Shift+Tab');
      const state = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement;
        const box = document.querySelector('.practice-panel')!.getBoundingClientRect();
        const r = active.getBoundingClientRect();
        return {
          inPanel: active.closest('.practice-panel') !== null,
          visible: r.top >= box.top - 1 && r.bottom <= box.bottom + 1,
          scrollY: window.scrollY,
        };
      });
      if (!state.inPanel) break;
      expect(state.visible, `control ${i} inside the panel's box`).toBe(true);
      expect(state.scrollY, `control ${i} left the page where it was`).toBe(y0);
    }
    await expectOneRed(page, 'tall systems');
  });
});

test.describe('the tightest panel (Op. 13 at 360 x 640)', () => {
  test.use({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });

  // The box holds three rows and a half: with the Hear row over Hands, Practice mode, Tempo, the
  // row and Hands cannot all stand in it. The control the reader used wins: Hands stands whole and
  // clear of the lower hairline, Tempo too, and Practice mode loses only the air above its switch.
  for (const how of ['tap', 'key'] as const) {
    test(`choosing a hand by ${how} leaves Hands whole and the head's switch in sight`, async ({
      page,
    }) => {
      await open(page, OP13, true, 'both');
      await openPractice(page);
      await settle(page);
      const panel = page.locator('.practice-panel');
      const hands = page.getByRole('group', { name: 'Hands' });
      const tempo = panel.locator('.tempo');
      const mode = panel.getByRole('switch', { name: 'Practice mode' });
      const modeRow = panel.locator('label', { hasText: 'Practice mode' });
      expect(await wholeInPanel(page, modeRow), 'Practice mode starts whole').toBe(true);
      expect(await wholeInPanel(page, hands), 'Hands starts whole').toBe(true);

      if (how === 'tap') {
        await page.getByRole('radio', { name: 'Right hand' }).locator('..').tap();
      } else {
        await page.getByRole('radio', { name: 'Both hands' }).focus();
        await page.keyboard.press('ArrowRight');
      }
      await expect(page.getByRole('switch', { name: 'Hear the left hand' })).toBeVisible();
      await settle(page);

      const box = (await panel.boundingBox())!;
      const handsBox = (await hands.boundingBox())!;
      const state = JSON.stringify({ box, handsBox });
      expect(handsBox.y, state).toBeGreaterThanOrEqual(box.y - 0.5);
      expect(handsBox.y + handsBox.height, state).toBeLessThanOrEqual(box.y + box.height - 0.5);
      expect(await wholeInPanel(page, tempo), state).toBe(true);
      expect(await wholeInPanel(page, mode), state).toBe(true);
      // The row itself loses no more than the air around its switch.
      const row = (await modeRow.boundingBox())!;
      expect(row.y, state).toBeGreaterThanOrEqual(box.y - 8);
      const cue = await panel.evaluate((el) => ({
        above: el.hasAttribute('data-above'),
        below: el.hasAttribute('data-below'),
      }));
      expect(cue.above, 'the upper edge says the head goes on above').toBe(true);
      expect(cue.below, 'the lower edge says more rows follow').toBe(true);
      await expectOneRed(page, 'Op. 13 at 360 x 640');
    });
  }
});

test.describe('a panel scrolled down at 360 x 600', () => {
  test.use({ viewport: { width: 360, height: 600 }, isMobile: true, hasTouch: true });

  test('the control just used keeps its place when a row arrives above it', async ({ page }) => {
    await open(page, OP13, true, 'both');
    await openPractice(page);
    const panel = page.locator('.practice-panel');
    const hands = page.getByRole('group', { name: 'Hands' });
    const state = () =>
      panel.evaluate((el) => ({
        scrollTop: el.scrollTop,
        overflow: el.scrollHeight - el.clientHeight,
        above: el.hasAttribute('data-above'),
        shadow: getComputedStyle(el).boxShadow,
      }));
    const fromDock = async () => {
      await settle(page);
      const dock = await page.evaluate(
        () => document.querySelector('.dock')!.getBoundingClientRect().bottom,
      );
      const box = (await hands.boundingBox())!;
      return dock - (box.y + box.height);
    };
    // Scrolled down a little, with Hands still in the box.
    await panel.evaluate((el) => {
      el.scrollTop = Math.min(30, el.scrollHeight - el.clientHeight);
    });
    await settle(page);
    const scrolled = await state();
    expect(scrolled.scrollTop, JSON.stringify(scrolled)).toBeGreaterThan(1);
    expect(await wholeInPanel(page, hands)).toBe(true);
    const before = await fromDock();
    await page.getByRole('radio', { name: 'Right hand' }).check();
    await expect(page.getByRole('switch', { name: 'Hear the left hand' })).toBeVisible();
    // Hands has not moved against the dock, and the top edge says the rows above it went on.
    expect(await fromDock()).toBeCloseTo(before, 0);
    expect(await wholeInPanel(page, hands)).toBe(true);
    const cue = await state();
    expect(cue.above, JSON.stringify(cue)).toBe(true);
    expect(cue.shadow, JSON.stringify(cue)).toContain('rgb(118, 118, 118)');
  });
});

test.describe('a long piece, built page by page, at 360 x 740', () => {
  test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });

  const read = (page: Page) =>
    page.evaluate(() => {
      const value = parseFloat(document.documentElement.style.getPropertyValue('--system-room'));
      const heights = Array.from(
        document.querySelectorAll('.score-sheet g.system'),
        (s) => Math.round(s.getBoundingClientRect().height * 10) / 10,
      );
      const dock = document.querySelector('.dock')!.getBoundingClientRect().height;
      return { value, tallest: Math.max(0, ...heights), dock, scrollY: window.scrollY };
    });

  test('the dock keeps its height while the reader reads', async ({ page }) => {
    await open(page, K545, true, 'both');
    await openPractice(page);
    await settle(page);
    const first = await read(page);
    expect(first.value, JSON.stringify(first)).toBeGreaterThanOrEqual(first.tallest + MARGIN - 0.5);
    const built = new Set<number>();
    for (let step = 1; step < 9; step++) {
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), step * 700);
      await settle(page);
      // Pages are built a moment after they come on screen.
      await page.waitForTimeout(250);
      const r = await read(page);
      built.add(Math.round(r.tallest));
      const at = JSON.stringify({ first, r });
      expect(r.value, `the room stays: ${at}`).toBe(first.value);
      expect(r.dock, `the dock stays: ${at}`).toBeCloseTo(first.dock, 1);
    }
    // The pages built on the way are not all alike (the reason the room is measured once), and a
    // panel opened again counts them.
    expect(built.size, JSON.stringify([...built])).toBeGreaterThan(1);
    await closePractice(page);
    await openPractice(page);
    await settle(page);
    const again = await read(page);
    expect(again.value, JSON.stringify(again)).toBeGreaterThanOrEqual(again.tallest + MARGIN - 0.5);
  });

  test('a new layout counts the systems built with it', async ({ page }) => {
    await open(page, K545, true, 'both');
    await openPractice(page);
    const room = () =>
      page.evaluate(() => {
        const value = parseFloat(document.documentElement.style.getPropertyValue('--system-room'));
        const heights = Array.from(
          document.querySelectorAll('.score-sheet g.system'),
          (s) => Math.round(s.getBoundingClientRect().height * 10) / 10,
        );
        return { value, tallest: Math.max(0, ...heights), systems: heights.length };
      });
    // A turn to landscape and back lays the piece out again; the systems built with the new layout
    // are in the DOM before any page is built after it.
    await page.setViewportSize({ width: 740, height: 360 });
    await page.waitForTimeout(500);
    await page.setViewportSize({ width: 360, height: 740 });
    await page.waitForTimeout(500);
    await expect(page.locator('.score-sheet g.system').first()).toBeAttached();
    await settle(page);
    // A panel opened again counts the systems built since the layout, and none of the landscape
    // layout's (its systems are about twice as tall).
    await closePractice(page);
    await openPractice(page);
    await settle(page);
    const r = await room();
    expect(r.systems, JSON.stringify(r)).toBeGreaterThan(0);
    expect(r.value, JSON.stringify(r)).toBeGreaterThanOrEqual(r.tallest + MARGIN - 0.5);
    expect(r.value, JSON.stringify(r)).toBeLessThanOrEqual(r.tallest + MARGIN + 40);
    const g = await geometry(page);
    expect(g.innerHeight - g.dockHeight, JSON.stringify(r)).toBeGreaterThanOrEqual(
      r.tallest + MARGIN - 0.5,
    );
  });
});

test.describe('a panel that cuts off controls at 360 x 740', () => {
  test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });

  test('marks each cut edge and shows every row whole when scrolled to it', async ({ page }) => {
    await open(page, MINUET, true);
    await openPractice(page);
    await page.getByRole('checkbox', { name: 'Loop bars' }).check();
    await settle(page);
    const panel = page.locator('.practice-panel');
    const state = () =>
      panel.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const row = Array.from(el.querySelectorAll('label')).find((l) =>
          /Practice mode/.test(l.textContent ?? ''),
        )!;
        const r = row.getBoundingClientRect();
        return {
          scrollTop: el.scrollTop,
          overflow: el.scrollHeight - el.clientHeight,
          above: el.hasAttribute('data-above'),
          below: el.hasAttribute('data-below'),
          shadow: getComputedStyle(el).boxShadow,
          rowWhole: r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5,
        };
      });
    // The fullest panel opens at its top: Practice mode stands whole and the lower edge marks the
    // rows below it.
    const cut = await state();
    expect(cut.overflow, JSON.stringify(cut)).toBeGreaterThan(0);
    expect(cut.scrollTop, JSON.stringify(cut)).toBe(0);
    expect(cut.rowWhole, JSON.stringify(cut)).toBe(true);
    expect(cut.above, JSON.stringify(cut)).toBe(false);
    expect(cut.below, JSON.stringify(cut)).toBe(true);
    expect(cut.shadow, JSON.stringify(cut)).not.toBe('none');
    // Scrolled to the end, the cue is at the top edge only: the rows that went are above it.
    await panel.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await settle(page);
    const end = await state();
    expect(end.above, JSON.stringify(end)).toBe(true);
    expect(end.below, JSON.stringify(end)).toBe(false);
    expect(end.shadow, JSON.stringify(end)).not.toBe('none');
    await expectOneRed(page, 'cut edges');
  });
});

test.describe('where the page stands when the panel opens', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test('a system the dock leaves alone does not move the page', async ({ page }) => {
    await open(page, MINUET, false);
    await embellishDecided(page);
    // The first system near the top of the window, as a reader who scrolled leaves it.
    await page.evaluate(() => {
      const top = document.querySelector('.score-sheet g.system')!.getBoundingClientRect().top;
      window.scrollTo({ top: window.scrollY + top - 60, behavior: 'instant' });
    });
    await settle(page);
    const before = await geometry(page);
    expect(before.reader!.bottom, JSON.stringify(before)).toBeLessThan(400);
    await openPractice(page);
    const after = await geometry(page);
    expect(after.dockTop, JSON.stringify(after)).toBeGreaterThan(before.reader!.bottom);
    expect(after.scrollY, JSON.stringify({ before, after })).toBe(before.scrollY);
  });

  test('a system the dock covers is brought above it, at once', async ({ page }) => {
    await open(page, MINUET, false);
    await embellishDecided(page);
    const before = await geometry(page);
    await openPractice(page);
    const after = await geometry(page);
    expect(after.scrollY, JSON.stringify({ before, after })).toBeGreaterThan(before.scrollY);
    expect(after.reader!.top).toBeGreaterThanOrEqual(0);
    expect(after.reader!.bottom).toBeLessThanOrEqual(after.dockTop + 0.5);
  });
});

test.describe('from piece to piece at 360 x 740', () => {
  test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });

  test('a score opened with Practice already open shows its first system above the dock', async ({
    page,
  }) => {
    await open(page, TWINKLE, false);
    await openPractice(page);
    await page.getByRole('button', { name: 'Back to the library' }).click();
    await libraryReady(page);
    await openLibraryPiece(page, MINUET);
    await expect(page.locator('.score-sheet g.fing').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.dock .practice-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect
      .poll(async () => {
        const g = await geometry(page);
        return g.reader !== null && g.reader.top >= 0 && g.reader.bottom <= g.dockTop + 0.5;
      })
      .toBe(true);
  });
});

test.describe('the desktop is unchanged', () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });

  test('opening Practice neither scrolls the page nor caps the panel', async ({ page }) => {
    await open(page, MINUET, true);
    const before = await page.evaluate(() => window.scrollY);
    await openPractice(page);
    await settle(page);
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
    expect(
      await page.locator('.practice-panel').evaluate((el) => getComputedStyle(el).maxHeight),
    ).toBe('none');
  });
});
