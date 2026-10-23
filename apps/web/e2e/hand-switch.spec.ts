import { expect, test, type Page } from '@playwright/test';
import { embellishDecided, openPractice } from './helpers/practice.js';

// Issue #79: switching between Left, Right and Both hands was sluggish on any long piece. Two
// causes, each guarded here by its mechanism rather than by milliseconds (timings flake under
// load): the hand left out was dimmed with `opacity` on its groups, and a translucent group
// holding transformed shapes (every notehead is a scaled `use`) gets a compositor layer of its own
// in Chrome, about 2,000 on a long piece, which every repaint then paid for; and the sweep faded
// every dimmed element of every page at once (8,818 transitions on a 780-bar piece).

const MOZART = 'mozart-sonata-k545-mvt1'; // 73 bars over several pages

async function openLong(page: Page): Promise<void> {
  await page.goto(`/?audio=silent#/piece/${MOZART}`);
  await expect(page.locator('.score-sheet g.fing').first()).toBeAttached({ timeout: 30_000 });
  await openPractice(page);
  await embellishDecided(page);
  // A reader practising a passage in the middle of the piece.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 3));
  // The passage is on screen once its pages are built (issue 99: they are built a frame after the
  // scroll, and a reader sees the music before switching a hand).
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.score-sheet g.system')].some((system) => {
      const r = system.getBoundingClientRect();
      return r.bottom > 0 && r.top < window.innerHeight;
    }),
  );
}

/**
 * Selects a hand the way a click does, and reads what the switch started in the same task: the
 * score's running animations (getAnimations flushes the style change that starts the sweep), the
 * elements swept, whether each swept element's system meets the window, and the elements dimmed.
 */
function switchTo(page: Page, hands: 'L' | 'R' | 'both') {
  return page.evaluate((hands) => {
    document.querySelector<HTMLInputElement>(`input[name="hands"][value="${hands}"]`)!.click();
    const sheet = document.querySelector('.score-sheet')!;
    const animations = document
      .getAnimations()
      .filter((a) => sheet.contains((a.effect as KeyframeEffect | null)?.target ?? null)).length;
    const swept = [...sheet.querySelectorAll('.is-sweeping')];
    const onScreen = swept.every((el) => {
      const r = el.closest('g.system')!.getBoundingClientRect();
      return r.bottom > 0 && r.top < window.innerHeight;
    });
    return {
      animations,
      swept: swept.length,
      sweptBars: new Set(swept.map((el) => el.closest('g.measure'))).size,
      // Every bar of the piece: on a piece of six pages or more only the pages near the screen
      // are in the DOM (issue 99), each page says how many bars it holds.
      bars: [...sheet.querySelectorAll(':scope > svg')].reduce(
        (sum, page) =>
          sum +
          (Number(page.getAttribute('data-bars')) || page.querySelectorAll('g.measure').length),
        0,
      ),
      pages: sheet.querySelectorAll(':scope > svg').length,
      onScreen,
      dimmed: sheet.querySelectorAll('.is-muted').length,
    };
  }, hands);
}

test('a hand switch sweeps only the systems on screen; the rest of the piece changes at once', async ({
  page,
}) => {
  await openLong(page);
  const left = await switchTo(page, 'L');
  expect(left.dimmed).toBeGreaterThan(0);
  // The sweep still runs where the reader looks (motion study 08)...
  expect(left.swept).toBeGreaterThan(0);
  expect(left.onScreen).toBe(true);
  // ...one transition per opacity property of each element swept, and nothing more.
  expect(left.animations).toBeGreaterThan(0);
  expect(left.animations).toBeLessThanOrEqual(2 * left.swept);
  // Right after Left: the right hand comes back and the left hand goes, on screen only.
  await page.waitForTimeout(400);
  const right = await switchTo(page, 'R');
  expect(right.onScreen).toBe(true);
  expect(right.animations).toBeLessThanOrEqual(2 * right.swept);
  // Both hands change on every bar, yet only the bars on screen sweep.
  expect(right.sweptBars).toBeGreaterThan(0);
  test.info().annotations.push({ type: 'pages', description: String(right.pages) });
  expect(right.sweptBars, 'bars swept of all bars').toBeLessThan(right.bars);
});

test('the hand left out is dimmed shape by shape, never by a translucent group of notes', async ({
  page,
}) => {
  await openLong(page);
  await switchTo(page, 'L');
  // The sweep settles: no element is left marked once its fade has ended.
  await expect(page.locator('.score-sheet .is-sweeping')).toHaveCount(0, { timeout: 5_000 });
  const drawn = await page.evaluate(() => {
    const groups: string[] = [];
    for (const el of document.querySelectorAll('.score-sheet svg *')) {
      const cs = getComputedStyle(el);
      const translucent = parseFloat(cs.opacity) < 1 || cs.filter !== 'none';
      // A translucent group holding a transformed shape is what costs a compositor layer.
      if (translucent && (el.hasAttribute('transform') || el.querySelector('use, [transform]'))) {
        groups.push(`${el.tagName}.${el.getAttribute('class') ?? ''}#${el.id}`);
      }
    }
    // A dimmed digit at rest is gray text through its own group opacity (no colour fringes).
    const digits = [...document.querySelectorAll('.score-sheet g.fing.is-muted')].map((d) => {
      const cs = getComputedStyle(d);
      return `${cs.opacity} ${cs.fillOpacity}`;
    });
    return { groups, digits: [...new Set(digits)] };
  });
  expect(drawn.groups, 'translucent groups holding transformed shapes').toEqual([]);
  expect(drawn.digits).toEqual(['0.4 1']);

  // What Chrome actually composites: a handful of layers, not one per dimmed group (about 2,000
  // on this piece before issue #79).
  const cdp = await page.context().newCDPSession(page);
  let layers = -1;
  cdp.on('LayerTree.layerTreeDidChange', (e) => {
    if (e.layers) layers = e.layers.length;
  });
  await cdp.send('LayerTree.enable');
  await page.mouse.move(5, 5);
  await expect.poll(() => layers, { timeout: 5_000 }).toBeGreaterThan(0);
  expect(layers).toBeLessThan(100);
  await cdp.send('LayerTree.disable');
});

// UI review 2026-10-20 (H1, H3): Left then Right within 100 ms flashed the right hand's digits pale
// (a fade in from the resting gray on digits never dimmed), and left cancelled fades marked.
test('a quick toggle turns the fade back without a flash, and every mark settles', async ({
  page,
}) => {
  await openLong(page);
  const flashing = await page.evaluate(async () => {
    const pick = (hands: string) =>
      document.querySelector<HTMLInputElement>(`input[name="hands"][value="${hands}"]`)!.click();
    pick('L');
    await new Promise((resolve) => setTimeout(resolve, 30));
    pick('R');
    return document
      .getAnimations()
      .filter((a) => (a as CSSAnimation).animationName === 'digit-back').length;
  });
  expect(flashing, 'digits fading in from a gray they never reached').toBe(0);
  await expect(page.locator('.score-sheet .is-sweeping')).toHaveCount(0, { timeout: 5_000 });
});

// Issue 99: on a long piece the pages a far scroll brings in are built a frame after it, so a hand
// switched in the same task meets a window with nothing in it. Those pages arrive dimmed at rest,
// as the piece stood when they were built, without a sweep; switching back is then an ordinary
// switch of gray digits, which fade back, since they really were gray.
test('a hand switched in the task of a far scroll: the pages arrive dimmed at rest, and the switch back fades them in', async ({
  page,
}) => {
  await page.goto(`/?audio=silent#/piece/${MOZART}`);
  await expect(page.locator('.score-sheet g.fing').first()).toBeAttached({ timeout: 30_000 });
  await openPractice(page);
  await embellishDecided(page);
  // The last page, never built at the open: a page already built in view would rightly sweep.
  const unbuilt = await page.evaluate(() => {
    const last = document.querySelector('.score-sheet svg[data-page]:last-child')!;
    const empty = last.childElementCount === 0;
    window.scrollTo(0, window.scrollY + last.getBoundingClientRect().top);
    document.querySelector<HTMLInputElement>('input[name="hands"][value="L"]')!.click();
    return empty;
  });
  expect(unbuilt, 'the last page is not built before the scroll').toBe(true);
  // The pages built a frame later, where the reader is, are dimmed at rest: no sweep, no fade
  // on any system in view.
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.score-sheet g.system')].some((system) => {
      const r = system.getBoundingClientRect();
      return r.bottom > 0 && r.top < window.innerHeight;
    }),
  );
  expect(await page.locator('.score-sheet .is-muted').count()).toBeGreaterThan(0);
  const arrived = await page.evaluate(
    () =>
      document.getAnimations().filter((a) => {
        const target = (a.effect as KeyframeEffect | null)?.target;
        const system = target?.closest('g.system');
        if (!system) return false;
        const r = system.getBoundingClientRect();
        return r.bottom > 0 && r.top < window.innerHeight;
      }).length,
  );
  expect(arrived, 'animations on the pages that arrived dimmed').toBe(0);
  await expect(page.locator('.score-sheet .is-sweeping')).toHaveCount(0, { timeout: 5_000 });
  // Back to both hands: the gray digits fade back in, and nothing stays dimmed.
  const back = await page.evaluate(() => {
    document.querySelector<HTMLInputElement>('input[name="hands"][value="both"]')!.click();
    return document
      .getAnimations()
      .filter((a) => (a as CSSAnimation).animationName === 'digit-back').length;
  });
  expect(back, 'digits fading back from the gray they were at').toBeGreaterThan(0);
  await expect(page.locator('.score-sheet .is-sweeping')).toHaveCount(0, { timeout: 5_000 });
  await expect(page.locator('.score-sheet .is-muted')).toHaveCount(0);
});

test('reduced motion: a hand switch is instant, nothing is swept', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openLong(page);
  const left = await switchTo(page, 'L');
  expect(left.dimmed).toBeGreaterThan(0);
  expect(left).toMatchObject({ swept: 0, animations: 0 });
});
