import { expect, test, type Page } from '@playwright/test';
import { openLibraryPiece, libraryReady } from './helpers/library.js';
import { fakeMidi, installFakeMidi } from './helpers/midi.js';
import { horizontalOverflow } from './helpers/overflow.js';
import { closePractice, embellishDecided, openPractice } from './helpers/practice.js';
import { expectOneRed } from './helpers/red.js';

// The Practice panel on a phone (issue 244): below 480 px the panel is capped so the piece's
// tallest system still fits above the dock and what does not fit scrolls inside it, and opening
// it brings the reader's system above the dock. A piano connected gives the panel its most
// controls (Practice mode, Hands, Hear the other hand). The e2e phone project is 360 x 740; the
// issue was seen at 375 x 812. This spec is not in the mobile project's list, so it runs in the
// desktop project with each describe's own phone viewport.

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

  test('the panel scrolls inside its cap, opens at its top and Hands keeps its place', async ({
    page,
  }) => {
    await open(page, OP13, true, 'both');
    await openPractice(page);

    const opened = await geometry(page);
    expect(opened.reader, JSON.stringify(opened)).not.toBeNull();
    expect(opened.reader!.top).toBeGreaterThanOrEqual(0);
    expect(opened.reader!.bottom).toBeLessThanOrEqual(opened.dockTop + 0.5);

    const hands = page.getByRole('group', { name: 'Hands' });
    const dockEdge = () =>
      page.evaluate(() => document.querySelector('.dock')!.getBoundingClientRect().bottom);
    const fromDock = async () => {
      await settle(page);
      const box = (await hands.boundingBox())!;
      return (await dockEdge()) - (box.y + box.height);
    };
    const before = await fromDock();
    await page.getByRole('radio', { name: 'Right hand' }).check();
    await expect(page.getByRole('switch', { name: 'Hear the left hand' })).toBeVisible();
    // The panel's rows grow upward from Play: Hands has not moved against the dock.
    expect(await fromDock()).toBeCloseTo(before, 0);

    const panel = page.locator('.practice-panel');
    const metrics = () =>
      panel.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    const m = await metrics();
    expect(m.scroll, 'the panel needs its own scroll').toBeGreaterThan(m.client);
    // Rows left the panel above its box (Practice mode was there a moment ago): the top edge says
    // so with a gray hairline, whatever lies under it.
    const cue = await panel.evaluate((el) => ({
      above: el.hasAttribute('data-above'),
      shadow: getComputedStyle(el).boxShadow,
    }));
    expect(cue.above, JSON.stringify(cue)).toBe(true);
    expect(cue.shadow, JSON.stringify(cue)).toContain('rgb(118, 118, 118)');

    const full = await geometry(page);
    expect(full.innerHeight - full.dockHeight).toBeGreaterThanOrEqual(full.tallest + MARGIN - 0.5);

    // Closed and opened again, it opens at its top: Practice mode and Tempo first.
    await closePractice(page);
    await openPractice(page);
    await settle(page);
    const inside = (name: string | RegExp) =>
      page.evaluate(
        ([label]) => {
          const panelBox = document.querySelector('.practice-panel')!.getBoundingClientRect();
          const el = Array.from(document.querySelectorAll('.practice-panel label')).find((l) =>
            new RegExp(label!).test(l.textContent ?? ''),
          )!;
          const box = el.getBoundingClientRect();
          return box.top >= panelBox.top - 0.5 && box.bottom <= panelBox.bottom + 0.5;
        },
        [typeof name === 'string' ? name : name.source],
      );
    expect(await inside('Practice mode')).toBe(true);
    expect(await inside('Tempo')).toBe(true);

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

test.describe('a long piece, built page by page, at 360 x 740', () => {
  test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });

  test('the room kept for a system never falls below one that is built', async ({ page }) => {
    await open(page, K545, true, 'both');
    await openPractice(page);
    const room = () =>
      page.evaluate(() => {
        const value = parseFloat(document.documentElement.style.getPropertyValue('--system-room'));
        const heights = Array.from(
          document.querySelectorAll('.score-sheet g.system'),
          (s) => Math.round(s.getBoundingClientRect().height * 10) / 10,
        );
        return { value, tallest: Math.max(0, ...heights), scrollY: window.scrollY };
      });
    let last = 0;
    for (let step = 0; step < 8; step++) {
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), step * 700);
      await settle(page);
      // Pages are built a moment after they come on screen.
      await page.waitForTimeout(250);
      const r = await room();
      const at = JSON.stringify(r);
      expect(r.value, at).toBeGreaterThanOrEqual(r.tallest + MARGIN - 0.5);
      expect(r.value, `never shrinks: ${at}`).toBeGreaterThanOrEqual(last - 0.01);
      last = r.value;
      const g = await geometry(page);
      expect(g.innerHeight - g.dockHeight, at).toBeGreaterThanOrEqual(r.tallest + MARGIN - 0.5);
    }
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
    const r = await room();
    expect(r.systems, JSON.stringify(r)).toBeGreaterThan(0);
    expect(r.value, JSON.stringify(r)).toBeGreaterThanOrEqual(r.tallest + MARGIN - 0.5);
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
    const cut = await state();
    expect(cut.overflow, JSON.stringify(cut)).toBeGreaterThan(0);
    // The fullest panel overflows: whatever is cut off at an edge is marked there by a shadow.
    expect(cut.overflow + cut.scrollTop > 1 || cut.scrollTop < -1, JSON.stringify(cut)).toBe(true);
    expect(cut.above, JSON.stringify(cut)).toBe(cut.overflow + cut.scrollTop > 1);
    expect(cut.below, JSON.stringify(cut)).toBe(cut.scrollTop < -1);
    // Scrolled to the top, Practice mode stands whole and the cue is at the bottom edge only.
    await panel.evaluate((el) => {
      el.scrollTop = -el.scrollHeight;
    });
    await settle(page);
    const top = await state();
    expect(top.rowWhole, JSON.stringify(top)).toBe(true);
    expect(top.above, JSON.stringify(top)).toBe(false);
    expect(top.below, JSON.stringify(top)).toBe(true);
    expect(top.shadow, JSON.stringify(top)).not.toBe('none');
    await expectOneRed(page, 'cut edges');
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
  test.use({ viewport: { width: 1280, height: 900 } });

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
