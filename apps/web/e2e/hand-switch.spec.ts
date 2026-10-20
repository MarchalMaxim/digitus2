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
  const total = await page.evaluate(
    () => document.querySelectorAll('.score-sheet g.measure').length,
  );
  const swept = await page.evaluate(
    () =>
      new Set(
        [...document.querySelectorAll('.score-sheet .is-sweeping')].map((e) =>
          e.closest('g.measure'),
        ),
      ).size,
  );
  expect(swept, 'bars swept of all bars').toBeLessThan(total);
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

test('reduced motion: a hand switch is instant, nothing is swept', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openLong(page);
  const left = await switchTo(page, 'L');
  expect(left.dimmed).toBeGreaterThan(0);
  expect(left).toMatchObject({ swept: 0, animations: 0 });
});
