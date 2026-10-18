import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectNoSeriousA11y } from './helpers/axe.js';
import { openPractice, setLoopBars } from './helpers/practice.js';
import { expectOneRed } from './helpers/red.js';
import { openLibraryPiece } from './helpers/library.js';
import { holdPianoSamples } from './helpers/samples.js';
import { STATES } from './helpers/states.js';

// The design brief and accessibility in every application state (verification spec 3.9): one
// red element (or one playback cursor), zero serious or critical axe violations, and no
// horizontal page scroll. Runs on the desktop and the 360 px mobile project, in the light theme
// and again with the system in dark (T7: the dark tokens must keep the contrasts and the one red).
for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme === 'light' ? 'light' : 'dark', () => {
    test.use({ colorScheme: scheme });

    for (const s of STATES) {
      const name = scheme === 'light' ? s.name : `${s.name} (dark)`;
      test(`state ${name}: one red element and no serious a11y issues`, async ({
        page,
      }, testInfo) => {
        test.skip(!!s.pcOnly && testInfo.project.name === 'mobile', 'reached only on a PC');
        await s.go(page);
        const roots = await expectOneRed(page, name);
        if (s.expectTag === 'cursor') expect(roots.every((r) => r.inSheet)).toBe(true);
        else if (s.expectTag === 'frame') expect(roots[0]!.className).toContain('drop-frame');
        else if (s.expectTag === 'note')
          expect(roots[0]!.inSheet && /\bnote\b/.test(roots[0]!.className)).toBe(true);
        else expect(roots[0]!.tag).toBe('button');
        await expectNoSeriousA11y(page, name);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${name} horizontal overflow`).toBeLessThanOrEqual(0);
      });
    }
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

/** The settings of a reader who has pressed Play before: no finger legend under the header. */
const legendSeen = (page: Page) =>
  page.addInitScript(() =>
    localStorage.setItem(
      'digitus2.settings.v1',
      JSON.stringify({ state: { settings: { legendSeen: true } }, version: 1 }),
    ),
  );

// T1 (UI batch, spec 13): the practice controls fold into one "Practice" toggle in the dock at
// every width, closed on every page load, so nothing stands between the title and the music. The
// first system's top is measured with the legend already seen (spec 17).
for (const [width, height, firstSystemMax] of [
  [360, 740, 240],
  [768, 1024, 220],
  [1280, 900, 220],
] as const) {
  test.describe(`the dock at ${width} px`, () => {
    test.use({ viewport: { width, height } });

    test('Practice is one closed toggle in the dock; the music starts high; opened, the controls sit above Play', async ({
      page,
    }) => {
      await legendSeen(page);
      await openTwinkle(page);
      const toggle = page.locator('.dock .practice-toggle');
      await expect(toggle).toHaveText('Practice');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByRole('slider', { name: 'Tempo' })).toBeHidden();
      const top = await page.evaluate(
        () => document.querySelector('.score-sheet svg g.system')!.getBoundingClientRect().top,
      );
      test
        .info()
        .annotations.push({ type: `first system top at ${width} (px)`, description: `${top}` });
      expect(top).toBeLessThanOrEqual(firstSystemMax);
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      for (const c of practiceControls(page).slice(0, 6)) await expect(c).toBeVisible();
      const g = await page.evaluate(() => ({
        panelBottom: document.querySelector('.practice-panel')!.getBoundingClientRect().bottom,
        playTop: document.querySelector('.dock .play-button')!.getBoundingClientRect().top,
        dockBottom: document.querySelector('.dock')!.getBoundingClientRect().bottom,
        columnBottom: document.querySelector('.score-main')!.getBoundingClientRect().bottom,
        systemTop: document.querySelector('.score-sheet svg g.system')!.getBoundingClientRect().top,
        height: window.innerHeight,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }));
      expect(g.panelBottom).toBeLessThanOrEqual(g.playTop + 0.5);
      // The dock grows upward and the music keeps its place. When the column runs past the
      // window, the dock is stuck to the window's bottom; when the whole column is shorter than
      // the window (Twinkle at 768 x 1024 with the legend seen), it sits in its own place at the
      // column's end, wholly on screen.
      expect(g.systemTop).toBeCloseTo(top, 0);
      expect(g.dockBottom).toBeLessThanOrEqual(g.height + 0.5);
      if (g.columnBottom > g.height + 0.5) {
        expect(Math.abs(g.dockBottom - g.height), JSON.stringify(g)).toBeLessThanOrEqual(0.5);
      } else {
        expect(Math.abs(g.dockBottom - g.columnBottom), JSON.stringify(g)).toBeLessThanOrEqual(0.5);
      }
      expect(g.overflow).toBeLessThanOrEqual(0);
      const roots = await expectOneRed(page, `Practice open at ${width}`);
      expect(roots[0]!.tag).toBe('button');
      await expectNoSeriousA11y(page, `Practice open at ${width}`);
      await page.getByRole('slider', { name: 'Tempo' }).focus();
      await page.keyboard.press('Escape');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(toggle).toBeFocused();
    });

    // UI batch review (WCAG 2.4.3): below 480 px the toggle stood after Rewind on screen but
    // first in the DOM, so Tab went Practice, Play, Rewind against the eye's Play, Rewind,
    // Practice. The toggle is now rendered where it stands: Tab follows the order on screen.
    test('Tab goes through the dock in its order on screen', async ({ page }) => {
      await legendSeen(page);
      await openTwinkle(page);
      await page.locator('.dock button').first().focus();
      const stops: { name: string; top: number; left: number; bottom: number }[] = [];
      for (let i = 0; i < 3; i++) {
        if (i > 0) await page.keyboard.press('Tab');
        stops.push(
          await page.evaluate(() => {
            const el = document.activeElement as HTMLElement;
            const r = el.getBoundingClientRect();
            const name = el.getAttribute('aria-label') ?? el.textContent!.trim();
            return { name, top: r.top, left: r.left, bottom: r.bottom };
          }),
        );
      }
      expect(stops.map((s) => s.name)).toEqual(
        width < 480 ? ['Play', 'Rewind', 'Practice'] : ['Practice', 'Play', 'Rewind'],
      );
      // Each stop is on a later row than the one before, or on the same row to its right.
      for (let i = 1; i < stops.length; i++) {
        const [a, b] = [stops[i - 1]!, stops[i]!];
        const sameRow = b.top < a.bottom && a.top < b.bottom;
        expect(sameRow ? b.left > a.left : b.top >= a.bottom - 0.5, JSON.stringify(stops)).toBe(
          true,
        );
      }
    });
  });
}

test.describe('the dock from 480 px', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('the status line shares the first row: the dock keeps its height, the keyboard its width', async ({
    page,
  }) => {
    await holdPianoSamples(page);
    await openTwinkle(page);
    const box = () =>
      page.evaluate(() => ({
        dock: document.querySelector('.dock')!.getBoundingClientRect().height,
        keys: document.querySelector('.dock .keyboard')!.getBoundingClientRect().width,
        dockWidth: document.querySelector('.dock')!.getBoundingClientRect().width,
        buttons: document.querySelector('.dock .transport-group')!.getBoundingClientRect().width,
      }));
    const before = await box();
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.getByRole('status')).toHaveText('Loading the piano…');
    const after = await box();
    expect(Math.abs(after.dock - before.dock)).toBeLessThanOrEqual(1);
    expect(before.keys).toBeGreaterThanOrEqual(before.dockWidth - before.buttons - 32);
  });

  test('Practice stays open from piece to piece within the visit', async ({ page }) => {
    await openTwinkle(page);
    await openPractice(page);
    await page.getByRole('button', { name: 'Back to the library' }).click();
    await openLibraryPiece(page, 'mary-had-a-little-lamb');
    await expect(page.locator('.dock .practice-toggle')).toHaveAttribute('aria-expanded', 'true');
    // For the visit only (spec 13 and 16): a reload closes it.
    await page.reload();
    await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled({ timeout: 20_000 });
    await expect(page.locator('.dock .practice-toggle')).toHaveAttribute('aria-expanded', 'false');
  });
});

// The Practice panel on a phone: what it holds survives the window crossing 480 px (the dock's
// layout changes there), and its longest copy fits at 360 px.
test.describe('the Practice panel on a phone', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('what was typed in the practice controls stays when the window crosses 480 px', async ({
    page,
  }) => {
    await openTwinkle(page);
    await openPractice(page);
    // Not a loop yet (from is after to), so nothing but the inputs holds it.
    await setLoopBars(page, '6', '2');
    await page.setViewportSize({ width: 600, height: 740 });
    await expect(page.getByLabel('Loop from bar')).toHaveValue('6');
    await expect(page.getByLabel('Loop to bar')).toHaveValue('2');
    await page.setViewportSize({ width: 360, height: 740 });
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
    await setLoopBars(page, '6', '2');
    const message = page.getByText('The loop needs "from" before "to".', { exact: true });
    await expect(message).toBeVisible();
    // Review of Task 4: the "Loop bars" tick box is a tick box like its neighbours (the bar
    // fields' width once spilled onto it, 80 px against 18), and the two bar fields share a row.
    const loopGeometry = await page.evaluate(() => {
      const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
      const check = (name: string) =>
        [...document.querySelectorAll<HTMLInputElement>('.practice-panel input[type="checkbox"]')]
          .find((i) => i.closest('label')!.textContent!.trim() === name)!
          .getBoundingClientRect();
      return {
        loopBars: check('Loop bars').width,
        metronome: check('Metronome').width,
        fromTop: box('[aria-label="Loop from bar"]').top,
        toTop: box('[aria-label="Loop to bar"]').top,
      };
    });
    expect(
      Math.abs(loopGeometry.loopBars - loopGeometry.metronome),
      JSON.stringify(loopGeometry),
    ).toBeLessThanOrEqual(0.5);
    expect(
      Math.abs(loopGeometry.fromTop - loopGeometry.toTop),
      JSON.stringify(loopGeometry),
    ).toBeLessThanOrEqual(1);
    const help = page.getByText(
      'Hand size changes the stretches the fingering allows. Choose child or small for small hands.',
      { exact: true },
    );
    await expect(help).toBeVisible();

    // Every control and every new line inside the window, none cut off at either edge.
    const shown = [
      ...practiceControls(page),
      page.getByRole('checkbox', { name: 'Loop bars' }),
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
  if (page.viewportSize()!.width < 480) {
    // Below 480 px the Practice toggle stands after Rewind, in the DOM as on screen.
    await page.keyboard.press('Tab');
    await expect(dock.locator('.practice-toggle')).toBeFocused();
  }
  await page.keyboard.press('Tab');
  await expect(dock.locator('.keyboard-scroll')).toBeFocused();
  await page.waitForTimeout(200);
  expect(await scrollY(), 'Tab through the dock at the top of the page').toBe(0);
  // A locator click scrolls its target into view first. Rewind is unavailable at the start
  // (aria-disabled, which Playwright's actionability check waits on) yet still takes the click.
  await expect(rewind).toHaveAttribute('aria-disabled', 'true');
  await rewind.click({ force: true });
  await page.waitForTimeout(200);
  expect(await scrollY(), 'a click on Rewind at the top of the page').toBe(0);
  await page.evaluate(() => window.scrollTo(0, 3000));
  await play.focus();
  await page.waitForTimeout(200);
  expect(await scrollY(), 'Play focused deep in the score').toBe(3000);
  const roots = await expectOneRed(page, 'a dock control focused');
  expect(roots[0]!.tag).toBe('button');
});
