import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectNoSeriousA11y } from './helpers/axe.js';
import { fakeMidi, installFakeMidi, type FakeMidiOptions } from './helpers/midi.js';
import { horizontalOverflow } from './helpers/overflow.js';
import { closePractice, embellishDecided, openPractice } from './helpers/practice.js';
import {
  ACCENT_RGB,
  expectOneRed,
  expectOneRedEveryFrame,
  recordRedFrames,
  redFrames,
} from './helpers/red.js';
import { redSettled, seekBar } from './helpers/seek.js';

// The halo of the waiting walk (issue 204). A step passes at the press; when the time to the next
// note is longer than a felt beat, a thin ring around that note closes in on it over that time.
// It is part of the cued note, so the screen keeps its one red. Twinkle with both hands, in
// performance order: [48 60] [60] [67] [67] [53 69] [69] [48 67] [53 65] [65] [48 64] [64] [55 62]
// [62] [48 60] ... Step 6 is the half note G and step 7 the F after it, which the ring rings; step
// 13 is the half note C. With the left hand chosen at 50 %, step 0 is a whole note: its ring
// around step 1 lasts 4.8 s.

const TWINKLE = 'twinkle-twinkle-little-star';
const TWINKLE_NOTES = 64;
/** The Practice tempo at its top, 150 %: every gap is two thirds as long. */
const FAST = { [TWINKLE]: 1.5 };
/** The reader plays the left hand, and the Practice tempo is 50 % (stored, never clicked). */
const HALF = { hands: 'L', tempoByPiece: { [`piece:${TWINKLE}`]: 0.5 } };

const rings = (page: Page): Locator => page.locator('.along-halo');
const practiceSwitch = (page: Page): Locator => page.getByRole('switch', { name: 'Practice mode' });

/**
 * Twinkle, ready, with a connected piano (the setting on and the permission granted). `query`
 * is the page's: the silent instrument by default.
 */
async function twinkle(
  page: Page,
  fake: FakeMidiOptions = {},
  query = 'audio=silent',
): Promise<ReturnType<typeof fakeMidi>> {
  await installFakeMidi(page, { permission: 'granted', playAlong: true, ...fake });
  await page.goto(`/?${query}#/piece/${TWINKLE}`);
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(TWINKLE_NOTES, {
    timeout: 20_000,
  });
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled();
  await embellishDecided(page, 'offered');
  return fakeMidi(page);
}

/**
 * Plays the steps the red waits on until the piece is finished: the walk has left its steps
 * (the flight home), or is back on an earlier one (under reduced motion the first group returns
 * within a frame).
 */
async function playToTheEnd(midi: ReturnType<typeof fakeMidi>): Promise<void> {
  for (let guard = 0; guard < 200; guard++) {
    const played = await midi.playRed();
    const now = await midi.index();
    if (now === -1 || now < played) return;
  }
  throw new Error('the piece did not finish');
}

/** Plays steps 0 to 6 (the seventh press is the half note G) and waits for the red on step 7. */
async function playToTheHalo(midi: ReturnType<typeof fakeMidi>): Promise<void> {
  for (let i = 0; i < 7; i++) await midi.playRed();
  expect(await midi.waitForStep()).toEqual([53, 65]);
}

test.describe('the halo of the waiting walk', () => {
  test('no halo after a quarter; after the half note one ring on the next note, part of the red note', async ({
    page,
  }) => {
    const midi = await twinkle(page);
    await midi.waitForStep();
    for (let i = 0; i < 6; i++) {
      await midi.playRed();
      expect(await midi.halo(), `a halo after step ${i}`).toBe(0);
      await expect(rings(page)).toHaveCount(0);
    }
    await midi.playRed(); // step 6, the half note G
    expect(await midi.waitForStep()).toEqual([53, 65]);
    await expect(rings(page)).toHaveCount(1);
    expect(Math.abs((await midi.halo()) - 1200)).toBeLessThanOrEqual(1);

    const where = await page.evaluate(() => {
      const ring = document.querySelector('.along-halo');
      if (!ring) return null;
      const parent = ring.parentElement!;
      const heads = [...document.querySelectorAll('.score-sheet .is-red .notehead')].sort(
        (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top,
      );
      return {
        isNote: parent.matches('g.note'),
        inRed: parent.closest('.is-red') !== null,
        holdsTopmost: heads.length > 0 && parent.contains(heads[0]!),
      };
    });
    expect(where, 'the ring was gone before it was measured').not.toBeNull();
    expect(where!.isNote, 'the ring is a child of a g.note').toBe(true);
    expect(where!.inRed, 'the ring is inside the red note').toBe(true);
    expect(where!.holdsTopmost, 'the ring sits on the topmost marked notehead').toBe(true);
    await expectOneRed(page, 'the ring on the next note');
  });

  test('it closes in, and is gone when the next note is due; the red note waits', async ({
    page,
  }) => {
    // At 50 % the ring lasts 2.4 s, so the reads below are well inside it.
    const midi = await twinkle(page, { tempo: { [TWINKLE]: 0.5 } });
    await midi.waitForStep();
    await playToTheHalo(midi);
    await expect(rings(page)).toHaveCount(1);
    expect(await midi.halo()).toBeGreaterThan(0);

    const radii = await page.evaluate(async () => {
      const read = () => Number(document.querySelector('.along-halo')?.getAttribute('r'));
      const first = read();
      await new Promise((r) => setTimeout(r, 300));
      return [first, read()];
    });
    expect(radii[0], `radii ${radii}`).toBeGreaterThan(0);
    expect(Number.isFinite(radii[1]), `the ring was gone at the second read: ${radii}`).toBe(true);
    expect(radii[1], `the ring did not close in: ${radii}`).toBeLessThan(radii[0]!);

    // The ring is removed when its time runs out: never while the hook still counts it, and within
    // two frames of the hook saying it is over.
    const ending = await page.evaluate(async () => {
      const hook = (window as unknown as { __digitus2Along: { halo(): number } }).__digitus2Along;
      return new Promise<{ tooSoon: boolean; lateMs: number; timedOut: boolean }>((resolve) => {
        const waited = performance.now();
        let zeroAt = 0;
        const look = () => {
          const now = performance.now();
          const here = document.querySelector('.along-halo') !== null;
          const counting = hook.halo() > 0;
          if (!counting && !zeroAt) zeroAt = now;
          if (!here) {
            resolve({ tooSoon: counting, lateMs: zeroAt ? now - zeroAt : 0, timedOut: false });
            return;
          }
          if (now - waited > 5_000) resolve({ tooSoon: false, lateMs: 0, timedOut: true });
          else requestAnimationFrame(look);
        };
        look();
      });
    });
    expect(ending.timedOut, 'the ring was never removed').toBe(false);
    expect(ending.tooSoon, 'the ring was removed while its time was running').toBe(false);
    expect(ending.lateMs, 'the ring outlived its time').toBeLessThanOrEqual(50);
    expect(await midi.index()).toBe(7);
    await expect(page.locator('.score-sheet .is-red').first()).toBeVisible();
    await expectOneRed(page, 'the ring is gone, the note waits');
    expect(await midi.halo()).toBe(0);
  });

  test('one red on every frame: a press, the ring life, a press before it closes, and the finish', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const midi = await twinkle(page, { tempo: FAST });
    await midi.waitForStep();
    await recordRedFrames(page);
    for (let i = 0; i < 7; i++) await midi.playRed();
    await page.waitForTimeout(300);
    // Step 7 pressed before its 800 ms halo closes: the next ring replaces it, here there is none
    // (step 7 is a quarter).
    await expect(rings(page)).toHaveCount(1);
    expect(await midi.halo(), 'the ring closed before the press').toBeGreaterThan(0);
    await midi.playRed();
    await expect(rings(page)).toHaveCount(0, { timeout: 300 });
    await playToTheEnd(midi);
    const frames = await redFrames(page);
    expectOneRedEveryFrame(frames, 'a press, the ring life, the finish');
    expect(
      frames.some((f) => f.halos === 1),
      'no frame showed the ring',
    ).toBe(true);
  });

  test('a seek and Practice mode off take the ring away at once', async ({ page }) => {
    // At 50 % each ring lasts 2.4 s: it cannot run out on its own during the checks.
    const midi = await twinkle(page, { tempo: { [TWINKLE]: 0.5 } });
    await midi.waitForStep();
    await playToTheHalo(midi);
    await expect(rings(page)).toHaveCount(1);
    expect(await midi.halo(), 'the ring closed before the seek').toBeGreaterThan(0);

    await recordRedFrames(page);
    await seekBar(page, 3);
    await expect(rings(page)).toHaveCount(0, { timeout: 500 });
    await redSettled(page);
    expectOneRedEveryFrame(await redFrames(page), 'a seek with the ring on');

    // Bar 3 starts on step 11; step 13 is the half note C, which rings step 14.
    expect(await midi.playRed()).toBe(11);
    expect(await midi.playRed()).toBe(12);
    expect(await midi.playRed()).toBe(13);
    await expect(rings(page)).toHaveCount(1);
    await openPractice(page);
    expect(await midi.halo(), 'the ring closed before the switch').toBeGreaterThan(0);
    await practiceSwitch(page).click();
    await expect(rings(page)).toHaveCount(0, { timeout: 500 });
    await expect(practiceSwitch(page)).not.toBeChecked();
    await closePractice(page);
    await expect.poll(() => midi.target()).toEqual([]);
  });

  test('the ring closes over the time to the next note at the Practice tempo', async ({ page }) => {
    const midi = await twinkle(page, { settings: HALF });
    expect(await midi.waitForStep()).toEqual([48]);
    await midi.playRed();
    expect(Math.abs((await midi.halo()) - 4800)).toBeLessThanOrEqual(1);
    await expect(rings(page)).toHaveCount(0, { timeout: 6_000 });
  });

  test('under reduced motion the ring steps once per beat and is gone at the end', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const midi = await twinkle(page);
    await midi.waitForStep();
    for (let i = 0; i < 6; i++) await midi.playRed();
    expect(await midi.waitForStep()).toEqual([48, 67]);

    // The seventh press (the half note G) is made in the page, and the ring's life is measured from
    // it: the round trips of the test do not count against the ring.
    const sampled = await page.evaluate(async () => {
      const w = window as unknown as {
        __digitus2Along: { target(): number[]; index(): number };
        __fakeMidi: { send(bytes: number[]): void };
      };
      const hook = w.__digitus2Along;
      const pitches = hook.target();
      const index = hook.index();
      for (const midi of pitches) w.__fakeMidi.send([0x90, midi, 100]);
      const t0 = performance.now();
      let released = false;
      const read = (): number | null => {
        const el = document.querySelector('.along-halo');
        return el ? Math.round(Number(el.getAttribute('r')) * 100) / 100 : null;
      };
      const values: number[] = [];
      let firstChange = 0;
      let gone = 0;
      let seen = false;
      await new Promise<void>((resolve) => {
        const look = () => {
          const now = performance.now();
          if (!released && hook.index() !== index) {
            for (const midi of pitches) w.__fakeMidi.send([0x80, midi, 0]);
            released = true;
          }
          const r = read();
          if (r !== null) {
            seen = true;
            if (!values.includes(r)) {
              values.push(r);
              if (values.length === 2) firstChange = now;
            }
          } else if (seen) {
            gone = now;
            resolve();
            return;
          }
          if (now - t0 > 5_000) resolve();
          else requestAnimationFrame(look);
        };
        look();
      });
      return {
        values,
        ms: gone ? gone - t0 : -1,
        step: firstChange ? firstChange - t0 : -1,
      };
    });
    expect(sampled.values.length, `radii ${sampled.values}`).toBe(2);
    expect(sampled.values[0]!, `radii ${sampled.values}`).toBeGreaterThan(sampled.values[1]!);
    expect(Math.abs(sampled.ms - 1200), `the ring lasted ${sampled.ms} ms`).toBeLessThanOrEqual(
      200,
    );
    expect(
      Math.abs(sampled.step - 600),
      `the radius stepped ${sampled.step} ms after the press`,
    ).toBeLessThanOrEqual(150);
  });

  for (const [width, height] of [
    [1280, 800],
    [360, 740],
  ] as const) {
    test.describe(`at ${width} px`, () => {
      test.use({ viewport: { width, height } });

      for (const scheme of ['light', 'dark'] as const) {
        test(`in the ${scheme} theme the ring is drawn in the accent with no fill, one red, axe clean, no overflow, hidden in print`, async ({
          page,
        }) => {
          await page.emulateMedia({ colorScheme: scheme });
          const midi = await twinkle(page, { settings: HALF });
          expect(await midi.waitForStep()).toEqual([48]);
          await midi.playRed();
          await expect(rings(page)).toHaveCount(1);

          const style = await page.evaluate(() => {
            const cs = getComputedStyle(document.querySelector('.along-halo')!);
            return { stroke: cs.stroke, fill: cs.fill, width: cs.strokeWidth };
          });
          expect(style.stroke).toBe(ACCENT_RGB);
          expect(style.fill).toBe('none');
          expect(style.width).toBe('2px');

          // In print the ring is not drawn (read first: the ring lasts 4.8 s).
          await page.emulateMedia({ colorScheme: scheme, media: 'print' });
          const printed = await page.evaluate(
            () => getComputedStyle(document.querySelector('.along-halo')!).display,
          );
          expect(printed).toBe('none');
          await page.emulateMedia({ colorScheme: scheme, media: 'screen' });

          const roots = await expectOneRed(page, `${scheme}, ${width} px, the ring`);
          expect(roots.every((r) => r.inSheet)).toBe(true);
          await expectNoSeriousA11y(page, `${scheme}, ${width} px, the ring`);
          // The ring is still there: this axe run happened while it was drawn.
          await expect(rings(page)).toHaveCount(1);
          expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
        });
      }
    });
  }
});
