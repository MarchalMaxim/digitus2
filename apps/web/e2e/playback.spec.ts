import { expect, test, type Page } from '@playwright/test';
import { expectNoSeriousA11y } from './helpers/axe.js';
import { expectOneRed } from './helpers/red.js';

/** The hook the app installs with `?audio=silent` (useCursor.ts). */
interface TestHook {
  positionSec(): number;
  cursorSec(): number;
  groupSecs(): number[];
}

function position(page: Page): Promise<number> {
  return page.evaluate(() =>
    (window as unknown as { __digitus2: TestHook }).__digitus2.positionSec(),
  );
}

/** A one-staff melody (the engine gives it to the right hand): two bars of quarter notes. */
function melodyXml(): string {
  const note = (step: string, octave: number) =>
    `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch>` +
    '<duration>1</duration><type>quarter</type></note>';
  const attributes =
    '<attributes><divisions>1</divisions><key><fifths>0</fifths></key>' +
    '<time><beats>4</beats><beat-type>4</beat-type></time>' +
    '<clef><sign>G</sign><line>2</line></clef></attributes>';
  const bar1 = ['C', 'D', 'E', 'F'].map((s) => note(s, 4)).join('');
  const bar2 = ['G', 'A', 'B'].map((s) => note(s, 4)).join('') + note('C', 5);
  return (
    '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0">' +
    '<part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>' +
    `<part id="P1"><measure number="1">${attributes}${bar1}</measure>` +
    `<measure number="2">${bar2}</measure></part></score-partwise>`
  );
}

test.describe('playback with the silent instrument', () => {
  test('play moves a red cursor through the score and lights keys with finger numbers; pause returns the red to Play', async ({
    page,
  }) => {
    await page.goto('/?audio=silent#/piece/twinkle-twinkle-little-star');
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
    // The count-in (one 2.4 s bar here) holds the cursor on the first notes; the next test covers it.
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.locator('.score-sheet .is-red').first()).toBeVisible({ timeout: 5_000 });
    const roots = await expectOneRed(page, 'playing');
    expect(roots.every((r) => r.inSheet)).toBe(true);
    const tick1 = Number(roots[0]!.onsetTick);
    await page.waitForTimeout(1500);
    const roots2 = await expectOneRed(page, 'playing later');
    expect(Number(roots2[0]!.onsetTick)).toBeGreaterThan(tick1);
    const pressed = page.locator('.keyboard .is-pressed');
    expect(await pressed.count()).toBeGreaterThan(0);
    await expect(pressed.first().locator('text')).toHaveText(/^[1-5]$/);
    await page.getByRole('button', { name: 'Pause' }).click();
    const paused = await expectOneRed(page, 'paused');
    expect(paused[0]!.tag).toBe('button');
    await expect(page.locator('.score-sheet .is-red')).toHaveCount(0);
    await expect(page.locator('.keyboard .is-pressed')).toHaveCount(0);
  });

  test('during the count-in the cursor waits on the first notes with their fingers, then moves on', async ({
    page,
  }) => {
    await page.goto('/?audio=silent#/piece/twinkle-twinkle-little-star');
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
    await expect(page.getByRole('checkbox', { name: 'Count-in' })).toBeChecked();
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.locator('.score-sheet .is-red').first()).toBeVisible({ timeout: 5_000 });
    const counting = await expectOneRed(page, 'count-in');
    expect(counting.every((r) => r.inSheet && r.onsetTick === '0')).toBe(true);
    await expect(page.locator('.keyboard .is-pressed').first().locator('text')).toHaveText(
      /^[1-5]$/,
    );
    await expect
      .poll(async () => Number((await expectOneRed(page, 'after the count-in'))[0]!.onsetTick), {
        timeout: 8_000,
      })
      .toBeGreaterThan(0);
  });

  test('left hand only: no right-hand keys light up', async ({ page }) => {
    await page.goto('/?audio=silent#/piece/twinkle-twinkle-little-star');
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
    await page.getByRole('radio', { name: 'Left hand' }).click();
    await page.getByRole('button', { name: 'Play' }).click();
    await page.waitForTimeout(1200);
    const hands = await page
      .locator('.keyboard .is-pressed')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-hand')));
    expect(hands.length).toBeGreaterThan(0);
    expect(new Set(hands)).toEqual(new Set(['L']));
  });

  test('a held note stays pressed while the other hand moves on', async ({ page }) => {
    // Twinkle's left hand holds whole and half notes under a quarter-note melody.
    await page.goto('/?audio=silent#/piece/twinkle-twinkle-little-star');
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    await page.getByRole('button', { name: 'Play' }).click();
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(400);
      const hands = await page
        .locator('.keyboard .is-pressed')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-hand')));
      expect(new Set(hands), `sample ${i}`).toEqual(new Set(['L', 'R']));
    }
  });

  test('the cursor is in sync with the transport clock within one frame', async ({ page }) => {
    await page.goto('/?audio=silent#/piece/twinkle-twinkle-little-star');
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    await page.getByRole('button', { name: 'Play' }).click();
    await page.waitForTimeout(2000);
    const { positionSec, cursorSec } = await page.evaluate(
      () =>
        (window as unknown as { __digitus2: { positionSec(): number; cursorSec(): number } })
          .__digitus2 && {
          positionSec: (
            window as never as { __digitus2: { positionSec(): number } }
          ).__digitus2.positionSec(),
          cursorSec: (
            window as never as { __digitus2: { cursorSec(): number } }
          ).__digitus2.cursorSec(),
        },
    );
    expect(Math.abs(positionSec - cursorSec)).toBeLessThan(0.7); // the current group started no more than one Twinkle beat (0.6 s) before the clock

    // The exact oracle, sampled across several groups: read in the frame right after the
    // cursor's own, the marked group is the last one that started at or before the clock (one
    // frame of slack when the clock has just crossed into the next group).
    const marks = new Set<number>();
    for (let i = 0; i < 12; i++) {
      const s = await page.evaluate(
        () =>
          new Promise<{ pos: number; cursor: number; secs: number[] }>((resolve) =>
            requestAnimationFrame(() => {
              const hook = (window as unknown as { __digitus2: TestHook }).__digitus2;
              resolve({
                pos: hook.positionSec(),
                cursor: hook.cursorSec(),
                secs: hook.groupSecs(),
              });
            }),
          ),
      );
      let k = 0;
      while (k + 1 < s.secs.length && s.secs[k + 1]! <= s.pos) k++;
      const justCrossed = k > 0 && s.pos - s.secs[k]! < 1 / 60;
      expect(
        s.cursor === s.secs[k] || (justCrossed && s.cursor === s.secs[k - 1]),
        `sample ${i}: clock ${s.pos} s, cursor on ${s.cursor} s, expected ${s.secs[k]} s`,
      ).toBe(true);
      marks.add(s.cursor);
      await page.waitForTimeout(170);
    }
    expect(marks.size).toBeGreaterThan(3); // the samples span several groups
  });

  test('Enter plays and pauses from the keyboard: the focus stays on the button through the first load', async ({
    page,
  }) => {
    await page.goto('/?audio=silent#/piece/twinkle-twinkle-little-star');
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    const play = page.getByRole('button', { name: 'Play' });
    await expect(play).toBeEnabled();
    await play.focus();
    await page.keyboard.press('Enter'); // the first Play of the score: the samples load first
    await expect(page.getByRole('button', { name: 'Pause' })).toBeFocused({ timeout: 5_000 });
    await expect(page.locator('.score-sheet .is-red').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Play' })).toBeFocused();
    await expect(page.locator('.score-sheet .is-red')).toHaveCount(0);
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Pause' })).toBeFocused();
    await expectOneRed(page, 'playing again from the keyboard');
  });

  test('a loop typed while playing waits for the typing to settle before it moves the playhead', async ({
    page,
  }) => {
    await page.goto('/?audio=silent#/piece/twinkle-twinkle-little-star');
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    await page.getByRole('button', { name: 'Play' }).click();
    // Twinkle's bars last 2.4 s: wait until bar 3.
    await expect.poll(() => position(page), { timeout: 10_000 }).toBeGreaterThan(5);
    await page.getByLabel('Loop from bar').fill('1');
    const before = await position(page);
    // Bars 1 to 12 hold the playhead, but the first keystroke alone means bars 1 to 1.
    await page.getByLabel('Loop to bar').pressSequentially('12', { delay: 80 });
    await page.waitForTimeout(800);
    expect(await position(page)).toBeGreaterThan(before);
    // A loop that leaves the playhead outside still applies once the typing stops.
    await page.getByLabel('Loop to bar').fill('1');
    await expect.poll(() => position(page), { timeout: 3_000 }).toBeLessThan(2.4);
    await expectOneRed(page, 'looping bar 1');
  });

  test('a one-hand piece with the other hand selected has nothing to play: Play stays red and unavailable', async ({
    page,
  }) => {
    await page.goto('/?audio=silent');
    await page.getByLabel('choose a file').setInputFiles({
      name: 'melody.musicxml',
      mimeType: 'application/xml',
      buffer: Buffer.from(melodyXml()),
    });
    const play = page.getByRole('button', { name: 'Play' });
    await expect(play).toBeEnabled({ timeout: 20_000 });
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    // A loop keeps the short piece playing, so only the hand switch can stop it.
    await page.getByLabel('Loop from bar').fill('1');
    await page.getByLabel('Loop to bar').fill('2');
    await play.click();
    await expect(page.locator('.score-sheet .is-red').first()).toBeVisible({ timeout: 5_000 });
    // Switching to the empty hand stops playback: Play is the red element again, unavailable.
    await page.getByRole('radio', { name: 'Left hand' }).click();
    await expect(page.getByRole('button', { name: 'Play' })).toBeDisabled();
    await expect(page.getByRole('status')).toHaveText('This piece has no notes for the left hand.');
    await expect(page.locator('.score-sheet .is-red')).toHaveCount(0);
    const roots = await expectOneRed(page, 'nothing to play');
    expect(roots[0]!.tag).toBe('button');
    await page.getByRole('radio', { name: 'Right hand' }).click();
    await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled();
    await expect(page.getByRole('status')).toHaveCount(0);
  });
});

test.describe('the keyboard on a phone', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('a wide piece keeps readable keys: the keyboard scrolls to the pressed keys, never the page', async ({
    page,
  }) => {
    await page.goto('/?audio=silent#/piece/mozart-sonata-k545-mvt1');
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(1288, { timeout: 20_000 });
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.locator('.score-sheet .is-red').first()).toBeVisible({ timeout: 5_000 });
    const white = await page.locator('.keyboard .key.is-white rect').first().boundingBox();
    expect(white!.width).toBeGreaterThanOrEqual(21.5);
    await expect(page.locator('.keyboard-scroll')).toHaveAttribute('tabindex', '0');
    for (let i = 0; i < 6; i++) {
      // Every pressed key is in view when they fit in the keyboard's width, else at least one.
      // Read at the start of a frame, as the reader sees it at the next paint.
      const view = await page.evaluate(async () => {
        await new Promise((r) => requestAnimationFrame(r));
        const box = document.querySelector('.keyboard-scroll')!.getBoundingClientRect();
        const keys = [...document.querySelectorAll('.keyboard .is-pressed rect')].map((r) =>
          r.getBoundingClientRect(),
        );
        const left = Math.min(...keys.map((k) => k.left));
        const right = Math.max(...keys.map((k) => k.right));
        const inView = keys.filter((k) => k.left >= box.left - 1 && k.right <= box.right + 1);
        return { pressed: keys.length, inView: inView.length, fits: right - left <= box.width };
      });
      expect(view.pressed, `sample ${i}`).toBeGreaterThan(0);
      expect(view.inView, `sample ${i}`).toBeGreaterThan(0);
      if (view.fits) expect(view.inView, `sample ${i}`).toBe(view.pressed);
      await page.waitForTimeout(250);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
    await expectOneRed(page, 'playing on a phone');
    await expectNoSeriousA11y(page, 'playing on a phone');
  });
});
