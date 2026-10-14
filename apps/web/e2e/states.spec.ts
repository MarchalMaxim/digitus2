import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectNoSeriousA11y } from './helpers/axe.js';
import { openPractice } from './helpers/practice.js';
import { expectOneRed } from './helpers/red.js';
import { STATES } from './helpers/states.js';

// The design brief and accessibility in every application state (verification spec 3.9): one
// red element (or one playback cursor), zero serious or critical axe violations, and no
// horizontal page scroll. Runs on the desktop and the 360 px mobile project.
for (const s of STATES) {
  test(`state ${s.name}: one red element and no serious a11y issues`, async ({ page }) => {
    await s.go(page);
    const roots = await expectOneRed(page, s.name);
    if (s.expectTag === 'cursor') expect(roots.every((r) => r.inSheet)).toBe(true);
    else expect(roots[0]!.tag).toBe('button');
    await expectNoSeriousA11y(page, s.name);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${s.name} horizontal overflow`).toBeLessThanOrEqual(0);
  });
}

// The dock (Play or Pause, Rewind and the keyboard) sticks to the bottom of the window while the
// score column is on screen. It must never hide the music or the side panel for good.
test.describe('the dock on a phone', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('the last system is fully visible above the dock at 360 px', async ({ page }) => {
    await page.goto('/#/piece/twinkle-twinkle-little-star');
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
    const dock = page.locator('.dock');
    await expect(dock.getByRole('button', { name: 'Play' })).toBeVisible();
    await expect(dock.getByRole('button', { name: 'Rewind' })).toBeVisible();
    await expect(dock.locator('.keyboard')).toBeVisible();

    const geometry = () =>
      page.evaluate(() => {
        const systems = document.querySelectorAll('.score-sheet svg g.system');
        const last = systems[systems.length - 1]!.getBoundingClientRect();
        const box = document.querySelector('.dock')!.getBoundingClientRect();
        const panel = document.querySelector('.side-panel')!.getBoundingClientRect();
        return {
          systems: systems.length,
          lastTop: last.top,
          lastBottom: last.bottom,
          dockTop: box.top,
          dockBottom: box.bottom,
          panelTop: panel.top,
          height: window.innerHeight,
        };
      });

    // Down the whole page, 100 px at a time: the dock never lies over the side panel.
    const max = await page.evaluate(
      () => document.documentElement.scrollHeight - window.innerHeight,
    );
    expect(max).toBeGreaterThan(0);
    for (let y = 0; ; y = Math.min(y + 100, max)) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      const g = await geometry();
      expect(g.dockBottom, `scrolled to ${y}`).toBeLessThanOrEqual(g.panelTop + 0.5);
      if (y === max) break;
    }
    // Scrolled to the end: the dock sits below the last system, not over it.
    const end = await geometry();
    expect(end.systems).toBeGreaterThan(1);
    expect(end.lastBottom).toBeLessThanOrEqual(end.dockTop + 0.5);

    // Brought into view the way the cursor and a focused control are (the page's bottom scroll
    // padding is the dock's measured height): the whole system shows above the stuck dock.
    await page.evaluate(() => {
      const systems = document.querySelectorAll('.score-sheet svg g.system');
      systems[systems.length - 1]!.scrollIntoView({ block: 'end' });
    });
    const shown = await geometry();
    expect(shown.dockBottom).toBeLessThanOrEqual(shown.height + 0.5);
    expect(shown.dockBottom).toBeGreaterThanOrEqual(shown.height - 0.5);
    expect(shown.lastTop).toBeGreaterThanOrEqual(0);
    expect(shown.lastBottom).toBeLessThanOrEqual(shown.dockTop + 0.5);
    const roots = await expectOneRed(page, 'the dock on a phone');
    expect(roots[0]!.tag).toBe('button');
    await expectNoSeriousA11y(page, 'the dock on a phone');
  });
});

/** Every practice control, by its accessible name. */
function practiceControls(page: Page): Locator[] {
  return [
    page.getByRole('slider', { name: 'Tempo' }),
    page.getByRole('radio', { name: 'Both hands' }),
    page.getByRole('radio', { name: 'Right hand' }),
    page.getByRole('radio', { name: 'Left hand' }),
    page.getByRole('checkbox', { name: 'Metronome' }),
    page.getByRole('checkbox', { name: 'Count-in' }),
    page.getByRole('spinbutton', { name: 'Loop from bar' }),
    page.getByRole('spinbutton', { name: 'Loop to bar' }),
  ];
}

/** Twinkle, ready, with its 64 digits. */
async function openTwinkle(page: Page): Promise<void> {
  await page.goto('/#/piece/twinkle-twinkle-little-star');
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled();
}

/**
 * The closed Practice disclosure on the first screen of a score, at the top of the page: in the
 * score column, before the sheet; its summary wholly on screen above the first system; and the
 * whole first system above the dock.
 */
async function expectPracticeAboveTheMusic(page: Page, label: string): Promise<void> {
  const layout = await page.evaluate(() => {
    const precedes = (a: Element, b: Element) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    const dock = document.querySelector('.dock')!;
    const details = document.querySelector('details.practice')!;
    const sheet = document.querySelector('.score-sheet')!;
    const summary = details.querySelector('summary')!.getBoundingClientRect();
    const system = sheet.querySelector('svg g.system')!.getBoundingClientRect();
    return {
      beforeSheet: precedes(details, sheet),
      inColumn: details.parentElement === dock.parentElement,
      summaryTop: summary.top,
      summaryBottom: summary.bottom,
      systemTop: system.top,
      systemBottom: system.bottom,
      dockTop: dock.getBoundingClientRect().top,
      scrollY: window.scrollY,
    };
  });
  const at = `${label}: ${JSON.stringify(layout)}`;
  expect(layout.beforeSheet, at).toBe(true);
  expect(layout.inColumn, at).toBe(true);
  expect(layout.scrollY, at).toBe(0);
  // Practice is on the first screen, above the music...
  expect(layout.summaryTop, at).toBeGreaterThanOrEqual(0);
  expect(layout.summaryBottom, at).toBeLessThanOrEqual(layout.systemTop);
  // ...and the first screen still shows a whole system above the dock.
  expect(layout.systemBottom, at).toBeLessThanOrEqual(layout.dockTop);
}

// Review S2: on a phone the title and the practice controls filled the first screen and K.545
// showed no staff at all. Below 480 px the practice controls fold into a closed "Practice"
// disclosure in their place above the score: one line, so the first screen shows the music, and
// the controls stay next to the title on any piece (under the dock, the review of Task 2 found
// them 14,190 px down K.545's 14,690 px page).
test.describe('the practice section on a phone', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('the practice controls sit in a closed Practice disclosure above the score', async ({
    page,
  }) => {
    await openTwinkle(page);
    const practice = page.locator('details.practice');
    await expect(practice).toHaveCount(1);
    await expect(practice).not.toHaveAttribute('open');
    const summary = practice.locator('summary');
    await expect(summary).toHaveText('Practice');
    await expect(summary).toBeVisible();
    for (const control of practiceControls(page)) await expect(control).toBeHidden();
    await expectPracticeAboveTheMusic(page, 'Twinkle');

    // Opened: every control shows, with one red element, no serious axe issue and no overflow.
    await summary.click();
    await expect(practice).toHaveAttribute('open', '');
    for (const control of practiceControls(page)) await expect(control).toBeVisible();
    const roots = await expectOneRed(page, 'practice open on a phone');
    expect(roots[0]!.tag).toBe('button');
    await expectNoSeriousA11y(page, 'practice open on a phone');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'horizontal overflow with the practice section open').toBeLessThanOrEqual(0);

    // The controls work from there, and the disclosure closes again.
    await page.getByRole('radio', { name: 'Left hand' }).check();
    await expect(page.getByRole('radio', { name: 'Left hand' })).toBeChecked();
    await summary.click();
    await expect(practice).not.toHaveAttribute('open');
    await expect(page.getByRole('radio', { name: 'Left hand' })).toBeHidden();
  });

  test('on a long piece too: K.545 opens with Practice above a whole system, one Tab after its credit', async ({
    page,
  }) => {
    await page.goto('/#/piece/mozart-sonata-k545-mvt1');
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(1288, { timeout: 20_000 });
    await expectPracticeAboveTheMusic(page, 'K.545');
    // From the title the keyboard reaches Practice in place, without scrolling the page.
    await page.getByRole('heading', { level: 1 }).focus();
    const summary = page.locator('details.practice > summary');
    for (let tabs = 0; tabs < 3; tabs++) {
      if (await summary.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press('Tab');
    }
    await expect(summary).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const roots = await expectOneRed(page, 'K.545 on a phone');
    expect(roots[0]!.tag).toBe('button');
    await expectNoSeriousA11y(page, 'K.545 on a phone');
  });

  test('what was typed in the practice controls stays when the window crosses 480 px', async ({
    page,
  }) => {
    await openTwinkle(page);
    await openPractice(page);
    // Not a loop yet (from is after to), so nothing but the inputs holds it.
    await page.getByLabel('Loop from bar').fill('6');
    await page.getByLabel('Loop to bar').fill('2');
    await page.setViewportSize({ width: 600, height: 740 });
    await expect(page.locator('details.practice')).toHaveCount(0);
    await expect(page.getByLabel('Loop from bar')).toHaveValue('6');
    await expect(page.getByLabel('Loop to bar')).toHaveValue('2');
    await page.setViewportSize({ width: 360, height: 740 });
    await expect(page.locator('details.practice')).toHaveCount(1);
    await expect(page.getByLabel('Loop from bar')).toHaveValue('6');
    await expect(page.getByLabel('Loop to bar')).toHaveValue('2');
    await expectOneRed(page, 'practice after crossing 480 px');
  });

  // Polish plan Task 6 and Review Focus 5: the practice controls' new copy (the tempo it makes,
  // the message for a reversed loop) and the hand size's help line must fit at 360 px. Checked
  // with the longest copy: a piece written at ♩ = 152 played at 150 %.
  test('no horizontal overflow with the practice section open', async ({ page }) => {
    await page.goto('/#/piece/burgmuller-op100-no1-la-candeur');
    await expect(page.locator('.score-sheet svg').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled();
    await openPractice(page);
    const tempo = page.locator('.tempo-value');
    await expect(tempo).toHaveText('100 % · ♩ = 152');
    await page.getByRole('slider', { name: 'Tempo' }).fill('150');
    await expect(tempo).toHaveText('150 % · ♩ = 228');
    await page.getByLabel('Loop from bar').fill('6');
    await page.getByLabel('Loop to bar').fill('2');
    const message = page.getByText('The loop needs "from" before "to".', { exact: true });
    await expect(message).toBeVisible();
    const help = page.getByText(
      'Hand size changes the stretches the fingering allows. Choose child or small for small hands.',
      { exact: true },
    );
    await expect(help).toBeVisible();

    // Every control and every new line inside the window, none cut off at either edge.
    const shown = [
      ...practiceControls(page),
      page.getByRole('button', { name: 'Clear loop' }),
      tempo,
      message,
      help,
      page.getByLabel('Hand size'),
    ];
    for (const el of shown) {
      await el.scrollIntoViewIfNeeded();
      const box = (await el.boundingBox())!;
      const at = `${await el.evaluate((e) => e.outerHTML.slice(0, 80))}: ${JSON.stringify(box)}`;
      expect(box.x, at).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, at).toBeLessThanOrEqual(360);
    }
    // The tempo and what it makes stay on one line next to the slider.
    const line = await page.evaluate(() => {
      const value = document.querySelector('.tempo-value')!.getBoundingClientRect();
      const slider = document.querySelector('.tempo input')!.getBoundingClientRect();
      const lineHeight = parseFloat(
        getComputedStyle(document.querySelector('.tempo-value')!).lineHeight,
      );
      return {
        valueHeight: value.height,
        lineHeight,
        sameRow: value.top < slider.bottom && value.bottom > slider.top,
      };
    });
    expect(line.valueHeight, JSON.stringify(line)).toBeLessThanOrEqual(line.lineHeight + 0.5);
    expect(line.sameRow, JSON.stringify(line)).toBe(true);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'horizontal overflow with the practice section open').toBeLessThanOrEqual(0);
    const roots = await expectOneRed(page, 'practice copy at 360 px');
    expect(roots[0]!.tag).toBe('button');
    await expectNoSeriousA11y(page, 'practice copy at 360 px');
  });
});

// Review of Task 2: the page's bottom scroll padding (the dock's height) made every focus on a
// control in the stuck dock scroll the page, although the dock is always on screen: Tab from the
// title moved a phone's page to 318 (Play), 636 (Rewind) and 1035 (the keyboard). Runs at 1280
// (desktop) and 360 px (mobile).
test('a control in the dock takes the focus, or a click, where the page is', async ({ page }) => {
  await page.goto('/#/piece/mozart-sonata-k545-mvt1');
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(1288, { timeout: 20_000 });
  const scrollY = () => page.evaluate(() => window.scrollY);
  const dock = page.locator('.dock');
  const play = dock.getByRole('button', { name: 'Play' });
  const rewind = dock.getByRole('button', { name: 'Rewind' });
  expect(await scrollY()).toBe(0);
  await play.focus();
  await page.keyboard.press('Tab');
  await expect(rewind).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dock.locator('.keyboard-scroll')).toBeFocused();
  await page.waitForTimeout(200);
  expect(await scrollY(), 'Tab through the dock at the top of the page').toBe(0);
  await rewind.click(); // a locator click scrolls its target into view first
  await page.waitForTimeout(200);
  expect(await scrollY(), 'a click on Rewind at the top of the page').toBe(0);
  await page.evaluate(() => window.scrollTo(0, 3000));
  await play.focus();
  await page.waitForTimeout(200);
  expect(await scrollY(), 'Play focused deep in the score').toBe(3000);
  const roots = await expectOneRed(page, 'a dock control focused');
  expect(roots[0]!.tag).toBe('button');
});

test.describe('the practice section at 480 px', () => {
  test.use({ viewport: { width: 480, height: 800 } });

  test('the practice controls stand open above the score, with no disclosure', async ({ page }) => {
    await openTwinkle(page);
    await expect(page.locator('details.practice')).toHaveCount(0);
    for (const control of practiceControls(page)) await expect(control).toBeVisible();
    const above = await page.evaluate(() => {
      const group = document.querySelector('[role="group"][aria-label="Practice"]')!;
      const sheet = document.querySelector('.score-sheet')!;
      return (group.compareDocumentPosition(sheet) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    });
    expect(above).toBe(true);
    await expectOneRed(page, 'practice at 480 px');
  });
});
