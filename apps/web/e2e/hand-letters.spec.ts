import { expect, test, type Page } from '@playwright/test';
import { embellishDecided, openPractice } from './helpers/practice.js';
import { expectOneRed } from './helpers/red.js';

const position = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __digitus2: { positionSec(): number } }).__digitus2.positionSec(),
  );
const keyboard = (page: Page) =>
  page.evaluate(() => ({
    pressed: document.querySelectorAll('.keyboard .key.is-pressed').length,
    letters: [...document.querySelectorAll('.keyboard .key-hand')].map((t) => t.textContent),
  }));

async function playSilently(page: Page, slug: string, tempoPercent = '100'): Promise<void> {
  await page.goto(`/?audio=silent#/piece/${slug}`);
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled({ timeout: 20_000 });
  await openPractice(page);
  await embellishDecided(page);
  await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
  if (tempoPercent !== '100') await page.getByRole('slider', { name: 'Tempo' }).fill(tempoPercent);
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('.keyboard .key.is-pressed').first()).toBeVisible({ timeout: 5_000 });
}

/** One frame of the keyboard beside the cursor's bar. */
interface Frame {
  /** The cursor's measure index (0-based). */
  m: number;
  pressed: number;
  letters: number;
  /** A scrolling keyboard shows one hand's pressed keys, and none of the other's. */
  lone: boolean;
  /** Both hands' pressed keys are in view. */
  both: boolean;
  /**
   * The keys have caught up with the red: the red moves ahead of the keyboard (React renders the
   * keys a frame or more later, more under load), so after the red enters a bar the keys are the
   * last bar's until they differ from the ones shown at the change (or a short cap passes).
   */
  settled: boolean;
}

/** From now on, every frame notes the cursor's bar, the pressed keys, the letters and the view. */
async function watchFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __frames: Frame[] };
    w.__frames = [];
    let before = -1;
    let atChange = '';
    let waited = 0;
    let pending = false;
    const frame = () => {
      const red = document.querySelector('.score-sheet .is-red');
      const bar = red?.closest('g.measure');
      const m = bar ? [...document.querySelectorAll('.score-sheet g.measure')].indexOf(bar) : -1;
      const scroller = document.querySelector('.keyboard-scroll');
      const keys = [...document.querySelectorAll('.keyboard .key.is-pressed')];
      if (m >= 0 && scroller && keys.length > 0) {
        const sig = keys.map((k) => k.getAttribute('data-midi')).join();
        if (m !== before) {
          pending = true;
          atChange = sig;
          waited = 0;
        } else if (pending && (sig !== atChange || ++waited > 12)) pending = false;
        before = m;
        const view = scroller.getBoundingClientRect();
        const scrolls = scroller.scrollWidth > scroller.clientWidth + 1;
        const seen = { L: 0, R: 0 };
        const out = { L: 0, R: 0 };
        for (const k of keys) {
          const r = k.getBoundingClientRect();
          const x = (r.left + r.right) / 2;
          const hand = k.getAttribute('data-hand') === 'L' ? 'L' : 'R';
          (!scrolls || (x >= view.left && x <= view.right) ? seen : out)[hand]++;
        }
        w.__frames.push({
          m,
          pressed: keys.length,
          letters: document.querySelectorAll('.keyboard .key-hand').length,
          lone:
            (seen.L === 0 && seen.R > 0 && out.L > 0) || (seen.R === 0 && seen.L > 0 && out.R > 0),
          both: seen.L > 0 && seen.R > 0,
          settled: !pending,
        });
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

/** Lets the piece play to its end, then returns every frame noted on the way. */
async function frames(page: Page): Promise<Frame[]> {
  await watchFrames(page);
  const pause = page.getByRole('button', { name: 'Pause' });
  while (await pause.isVisible()) await page.waitForTimeout(250);
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible(); // the piece ended
  return page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames);
}

// T11 (spec 15): "Only when the L and R notes are close to each other". The score alone decides
// that on a keyboard that shows every key (the desktop project). Where the keyboard scrolls (the
// mobile project), rule 5 adds the bars where one hand is out of view: Amazing Grace's right hand
// in measure indices 7 and 8, lettered from the onset where it leaves to the end of the bar. The
// whole piece is sampled at 150 %, frame by frame.
test('Amazing Grace: no hand letters, except where a scrolling keyboard hides a hand, to the end of that bar', async ({
  page,
}, testInfo) => {
  const phone = testInfo.project.name === 'mobile';
  await playSilently(page, 'amazing-grace', '150');
  const all = await frames(page);
  expect(all.length, 'frames with keys down').toBeGreaterThan(50);
  expect(Math.max(...all.map((f) => f.m)), 'sampled through bars 8 and 9').toBeGreaterThanOrEqual(
    8,
  );
  for (const f of all) {
    expect(f.lone && f.letters === 0, `a lone number in measure ${f.m}`).toBe(false);
    if (f.letters > 0) expect(f.letters, `letters in measure ${f.m}`).toBe(f.pressed);
  }
  const settled = all.filter((f) => f.settled);
  const lettered = [...new Set(settled.filter((f) => f.letters > 0).map((f) => f.m))];
  if (!phone) {
    expect(lettered, 'the hands never come within a fifth, and every key shows').toEqual([]);
    return;
  }
  // The right hand leaves the view in both bars, and only there is anything lettered.
  expect(
    lettered.sort((a, b) => a - b),
    'bars lettered (measure indices)',
  ).toEqual([7, 8]);
  for (const m of lettered) {
    const bar = settled.filter((f) => f.m === m);
    const first = bar.findIndex((f) => f.letters > 0);
    const out = bar.findIndex((f) => f.lone);
    // The letters start at the onset where a hand leaves the view, not at the bar's start...
    expect(out, `a hand out of view in measure ${m}`).toBeGreaterThanOrEqual(0);
    expect(
      first,
      `letters start no earlier than the hand leaves, measure ${m}`,
    ).toBeGreaterThanOrEqual(out);
    expect(bar[first]!.lone, `letters start where the hand is out of view, measure ${m}`).toBe(
      true,
    );
    // ...and stay on to its end.
    expect(
      bar.slice(first).every((f) => f.letters > 0),
      `letters stay to the end of measure ${m}`,
    ).toBe(true);
  }
});

// The same fallback on a piece whose hands are far apart most of the way: the left hand is out of
// view in measure indices 15 to 19, and the right hand's numbers must not stand alone there.
test('G major minuet: no lone number at any frame; far-apart bars with both hands in view stay plain', async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  await playSilently(page, 'bach-minuet-g-major-bwv-anh-114', '150');
  const all = await frames(page);
  expect(all.length, 'frames with keys down').toBeGreaterThan(300);
  expect(Math.max(...all.map((f) => f.m)), 'sampled to the last bars').toBeGreaterThanOrEqual(30);
  for (const f of all) {
    expect(f.lone && f.letters === 0, `a lone number in measure ${f.m}`).toBe(false);
    if (f.letters > 0) expect(f.letters, `letters in measure ${f.m}`).toBe(f.pressed);
  }
  // Bars 2 to 6 (measure indices 1 to 5) put the hands far apart and, on a phone, both in view.
  for (const f of all.filter((x) => x.settled && x.m >= 1 && x.m <= 5 && x.both)) {
    expect(f.letters, `letters in measure ${f.m}`).toBe(0);
  }
  // Lettered bars are the score's, the bars where a hand was seen out of view, and the lone bar
  // between such a bar and a lettered bar: nothing else.
  const settled = all.filter((f) => f.settled);
  const scoreBars = new Set([0, 6, 7, 11, 14, 24, 25, 26, 27, 31]);
  const hiddenBars = new Set(settled.filter((f) => f.lone).map((f) => f.m));
  const allowed = new Set([...scoreBars, ...hiddenBars]);
  for (const m of hiddenBars) if (scoreBars.has(m + 2)) allowed.add(m + 1);
  const lettered = [...new Set(settled.filter((f) => f.letters > 0).map((f) => f.m))].sort(
    (a, b) => a - b,
  );
  expect(
    lettered.filter((m) => !allowed.has(m)),
    'bars lettered with no reason',
  ).toEqual([]);
  if (testInfo.project.name === 'mobile') {
    for (const m of [15, 16, 17, 18, 19, 23, 30]) {
      expect(lettered, `measure ${m} is lettered where the left hand is out of view`).toContain(m);
    }
  } else {
    expect(hiddenBars.size, 'no hand is out of view at 1280 px').toBe(0);
  }
});

test('Twinkle: no letters in bars 1 to 3; L and R together from bar 4, where the hands come close', async ({
  page,
}) => {
  await playSilently(page, 'twinkle-twinkle-little-star');
  // 100 qpm in 4/4: bar 4 (measure index 3) starts at 7.2 s.
  while ((await position(page)) < 6.9) {
    const k = await keyboard(page);
    if (k.pressed > 0) expect(k.letters).toEqual([]);
    await page.waitForTimeout(150);
  }
  await expect.poll(() => position(page), { timeout: 5_000 }).toBeGreaterThan(7.4);
  const k = await keyboard(page);
  expect(new Set(k.letters)).toEqual(new Set(['L', 'R']));
  expect(k.letters).toHaveLength(k.pressed);
  await expectOneRed(page, 'Twinkle bar 4');
});

// T10 and T11: paused, the pressed keys keep their finger numbers. In bar 1 the hands are an
// octave apart, so the third note's keys carry their digits alone, without L or R.
test('Twinkle paused in bar 1: the pressed keys carry their finger numbers, no hand letters', async ({
  page,
}) => {
  await playSilently(page, 'twinkle-twinkle-little-star', '50');
  // The third note sounds from 1.2 s to 1.8 s of the score: at 50 %, 1.2 s of the clock to pause in.
  await expect
    .poll(() => position(page), { timeout: 10_000, intervals: [50] })
    .toBeGreaterThan(1.25);
  await page.getByRole('button', { name: 'Pause' }).click();
  const pressed = page.locator('.keyboard-svg .key.is-pressed');
  expect(
    await pressed.evaluateAll((keys) => keys.map((key) => Number(key.getAttribute('data-midi')))),
  ).toEqual([48, 67]);
  await expect(pressed.locator('text')).toHaveText(['5', '4']);
  await expect(page.locator('.keyboard-svg .key-hand')).toHaveCount(0);
});
