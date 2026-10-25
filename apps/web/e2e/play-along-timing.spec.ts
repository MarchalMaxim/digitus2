import { mkdirSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectNoSeriousA11y } from './helpers/axe.js';
import {
  fakeMidi,
  installFakeMidi,
  walkRhythm,
  walkTiming,
  type RhythmPlan,
  type RhythmReport,
} from './helpers/midi.js';
import { horizontalOverflow } from './helpers/overflow.js';
import { embellishDecided } from './helpers/practice.js';
import { expectOneRed } from './helpers/red.js';
import { seekBar } from './helpers/seek.js';

// Timing in the waiting walk (issue 192). With the fake piano connected and Practice mode on, the
// red waits for the reader, and digitus compares the gaps between the reader's presses with the
// written gaps, at the reader's own tempo; after each bar it rings the note that came clearly early
// or late. `walkRhythm` (helpers/midi.ts) walks steps on the fake piano in a set rhythm, entirely
// in the page, stamping each press with the instant it was scheduled for.
//
// Twinkle at 75 %: a quarter is 0.6 performance seconds and its hold 800 ms real. The reader plays
// at 2,500 ms per performance second, a quarter in 1,500 ms, so the page has 700 ms to render a
// judgement before the next press. The tolerance there is a quarter of a beat, 375 ms; a note
// pressed 600 ms early is 225 ms clear of it.
//
// Twinkle's steps (both hands) start [48 60] [60] [67] [67] [53 69] [69] [48 67] [53 65] [65]
// [48 64] [64]: the left hand plays 48, 53 and 55, the right hand the tune. Bar 0 holds steps 0
// to 3, bar 1 steps 4 to 6 (the last a half note) and bar 2 steps 7 to 10.

const TWINKLE = 'twinkle-twinkle-little-star';
const TWINKLE_NOTES = 64;
const TEMPO = 0.75;
const FIRST_STEPS = [
  [48, 60],
  [60],
  [67],
  [67],
  [53, 69],
  [69],
  [48, 67],
  [53, 65],
  [65],
  [48, 64],
  [64],
];
const FIRST_BARS = [0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 2];
/** Real milliseconds per performance second: a quarter in 1,500 ms. */
const MS_PER_SEC = 2500;
/** A rushed note's offset, 225 ms clear of the 375 ms tolerance. */
const RUSH_MS = 600;
/** A hesitation: the gap of 4,500 ms is past the pause line of 1,500 + 300 + 1,500 ms. */
const PAUSE_MS = 3000;
const EXPLAIN = 'A ring before a note means it came early; after it, late.';
const HINT_MANY = 'Play the red notes on your piano.';
const HOLD_MANY = 'Hold the red notes a little longer.';

const status = (page: Page): Locator => page.locator('.dock [role="status"]');
const rings = (page: Page, verdict?: string): Locator =>
  page.locator(verdict ? `.timing-mark[data-timing="${verdict}"]` : '.timing-mark');

/** What the last `walk` of the test sent, for the evidence a failure attaches. */
let lastReport: RhythmReport | null = null;

test.beforeEach(() => {
  lastReport = null;
});

// A failed check says what the hook and the page showed.
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  try {
    const timing = walkTiming(page);
    const body = JSON.stringify(
      {
        judged: await timing.judged(),
        onsets: await timing.onsets(),
        markCount: await timing.markCount(),
        rings: await rings(page).count(),
        status: await status(page).textContent(),
        sent: lastReport?.sent ?? null,
      },
      null,
      2,
    );
    await testInfo.attach('walk-timing.json', { body, contentType: 'application/json' });
    console.log(`the walk's timing at the failure of "${testInfo.title}":\n${body}`);
  } catch {
    // The page is gone: nothing more to read.
  }
});

/** Walks a rhythm and keeps its report. */
async function walk(page: Page, plan: RhythmPlan): Promise<RhythmReport> {
  lastReport = await walkRhythm(page, plan);
  return lastReport;
}

/** Twinkle at 75 % with the fake piano connected; the walk on its first step. */
async function twinkle(page: Page): Promise<{
  midi: ReturnType<typeof fakeMidi>;
  steps: Awaited<ReturnType<ReturnType<typeof walkTiming>['steps']>>;
}> {
  await installFakeMidi(page, {
    permission: 'granted',
    playAlong: true,
    tempo: { [TWINKLE]: TEMPO },
  });
  await page.goto(`/?audio=silent#/piece/${TWINKLE}`);
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(TWINKLE_NOTES, {
    timeout: 20_000,
  });
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled();
  await embellishDecided(page, 'offered');
  const midi = fakeMidi(page);
  await midi.waitForStep();
  const steps = await walkTiming(page).steps();
  expect(steps.slice(0, FIRST_STEPS.length).map((s) => s.pitches)).toEqual(FIRST_STEPS);
  expect(steps.slice(0, FIRST_BARS.length).map((s) => s.bar)).toEqual(FIRST_BARS);
  expect(Math.abs(steps[1]!.holdMs - 800)).toBeLessThanOrEqual(1);
  return { midi, steps };
}

/** Rewind, and the walk waits on the piece's first step again. */
async function rewind(page: Page, midi: ReturnType<typeof fakeMidi>): Promise<void> {
  await page.getByRole('button', { name: 'Rewind' }).click();
  await expect.poll(() => midi.index()).toBe(0);
  expect(await midi.waitForStep()).toEqual(FIRST_STEPS[0]);
}

/** Step 2 pressed 600 ms early, steps 0 to 4 walked: bar 0 is judged as the red leaves it. */
function rushedBar(page: Page): Promise<RhythmReport> {
  return walk(page, { from: 0, to: 4, msPerSec: MS_PER_SEC, offsets: { 2: -RUSH_MS } });
}

test.describe('timing in the waiting walk', () => {
  test('the first step needs every key, held; a tap asks for a longer hold', async ({ page }) => {
    const { midi } = await twinkle(page);
    const hold = await midi.hold();

    // One key of [48 60], held for twice the step's time, moves nothing.
    await midi.noteOn(60);
    await page.waitForTimeout(2 * hold);
    expect(await midi.index()).toBe(0);
    await expect(status(page)).toHaveText(HINT_MANY);
    // The other key, with the first still down: after the hold the red moves on.
    await midi.noteOn(48);
    await expect.poll(() => midi.index()).toBe(1);
    await midi.noteOff(60);
    await midi.noteOff(48);

    // A tap of both keys, let go before four fifths of the hold, asks for a longer one.
    await rewind(page, midi);
    await midi.tap([48, 60], 100);
    await expect(status(page)).toHaveText(HOLD_MANY);
    expect(await midi.index()).toBe(0);
    expect(await midi.playRed()).toBe(0);
    await expect.poll(() => midi.index()).toBe(1);
    await expectOneRed(page, 'the first step');
  });

  test('an even walk leaves no ring, and each onset carries the event time', async ({ page }) => {
    await twinkle(page);
    const { sent } = await walk(page, { from: 0, to: 10, msPerSec: MS_PER_SEC });

    await expect
      .poll(async () => (await walkTiming(page).judged()).map((j) => j.index))
      .toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const judged = await walkTiming(page).judged();
    expect(judged.map((j) => j.bar)).toEqual([0, 0, 1, 1, 1, 2, 2, 2, 2]);
    expect(judged.map((j) => j.verdict)).toEqual(judged.map(() => 'onTime'));

    const onsets = await walkTiming(page).onsets();
    expect(sent.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const s of sent) {
      const onset = onsets.find((o) => o.index === s.index);
      expect(onset?.ms, `step ${s.index}: the onset is the stamped event time`).toBe(s.atMs);
    }
    await expect(rings(page)).toHaveCount(0);
    expect(sent.map((s) => s.status)).not.toContain(EXPLAIN);
    expect(await walkTiming(page).markCount()).toBe(0);
    await expectOneRed(page, 'an even walk');
  });

  test('a rushed note gets one ring before it once the bar is left', async ({ page }) => {
    const { steps } = await twinkle(page);
    const { sent } = await rushedBar(page);

    // Bar 0 is judged as the red leaves it, at step 3's pass: not yet at step 3's press, and
    // long before step 4's.
    expect(sent[3]!.marks, 'rings before bar 0 is left').toBe(0);
    expect(sent[4]!.marks, 'rings once bar 0 is left').toBe(1);
    await expect(rings(page)).toHaveCount(1);
    await expect(rings(page, 'early')).toHaveCount(1);
    expect(await walkTiming(page).markCount()).toBe(1);

    // The ring sits left of its note.
    const shape = await page.evaluate((id) => {
      const head = document.querySelector(`[id="${id}"] g.notehead`)!;
      const ring = head.closest('g.staff')!.querySelector('.timing-mark circle')!;
      return {
        ringRight: ring.getBoundingClientRect().right,
        headLeft: head.getBoundingClientRect().left,
      };
    }, steps[2]!.ids[0]!);
    expect(shape.ringRight).toBeLessThan(shape.headLeft);

    const judged = await walkTiming(page).judged();
    const off = judged.filter((j) => j.verdict !== 'onTime');
    expect(off.map((j) => [j.index, j.verdict])).toEqual([[2, 'early']]);
    expect(off[0]!.offsetMs).toBeCloseTo(-RUSH_MS, 0);
    expect(off[0]!.tolMs).toBeCloseTo(375, 0);
    const onset = (await walkTiming(page).onsets()).find((o) => o.index === 2);
    expect(onset?.ms).toBe(sent[2]!.atMs);

    await expect(status(page)).toHaveText(EXPLAIN);
    await expectOneRed(page, 'a rushed note');
  });

  test('the explanation leaves after two more bars, and the ring stays', async ({ page }) => {
    test.setTimeout(120_000);
    await twinkle(page);
    const { sent } = await walk(page, {
      from: 0,
      to: 10,
      msPerSec: MS_PER_SEC,
      offsets: { 2: -RUSH_MS },
    });
    // Bar 0 was judged at step 3's pass, bar 1 at step 6's pass: one bar after, it is still said.
    expect(sent[4]!.status).toBe(EXPLAIN);
    expect(sent[7]!.status).toBe(EXPLAIN);
    // Bar 2 is judged at step 10's pass, the second bar after it appeared.
    await expect(status(page)).toHaveText('');
    await expect(rings(page)).toHaveCount(1);
    await expectOneRed(page, 'after the explanation');
  });

  test('a long hesitation is not judged', async ({ page }) => {
    test.setTimeout(120_000);
    await twinkle(page);
    await walk(page, { from: 0, to: 10, msPerSec: MS_PER_SEC, pauses: { 5: PAUSE_MS } });

    await expect
      .poll(async () => (await walkTiming(page).judged()).some((j) => j.index === 10))
      .toBe(true);
    const judged = await walkTiming(page).judged();
    const indices = judged.map((j) => j.index);
    expect(indices).not.toContain(5);
    expect(indices).not.toContain(6);
    for (const index of [7, 8, 9, 10]) expect(indices).toContain(index);
    expect(judged.filter((j) => j.index >= 7).map((j) => j.verdict)).toEqual(
      judged.filter((j) => j.index >= 7).map(() => 'onTime'),
    );
    await expect(rings(page)).toHaveCount(0);
    expect(await walkTiming(page).markCount()).toBe(0);
    await expectOneRed(page, 'a hesitation');
  });

  test('replaying a bar clears its rings; the explanation stays gone', async ({ page }) => {
    test.setTimeout(120_000);
    const { midi, steps } = await twinkle(page);
    await rushedBar(page);
    await expect(rings(page, 'early')).toHaveCount(1);

    // Rewind breaks the chain and keeps the ring.
    await rewind(page, midi);
    await expect(rings(page)).toHaveCount(1);

    // Bar 0 played again: its ring goes at the first step passed. Step 6 is pressed early, in bar 1
    // (both hands), which is judged when the red moves on to step 7.
    const { sent } = await walk(page, {
      from: 0,
      to: 7,
      msPerSec: MS_PER_SEC,
      offsets: { 6: -RUSH_MS },
    });
    expect(sent[1]!.marks, 'bar 0 loses its ring at its first step').toBe(0);
    expect(sent.map((s) => s.status)).not.toContain(EXPLAIN);

    await expect(rings(page)).toHaveCount(2);
    await expect(rings(page, 'early')).toHaveCount(2);
    const placed = await page.evaluate((ids) => {
      const found = [...document.querySelectorAll('.timing-mark')].map((ring) => {
        const staff = ring.closest('g.staff')!;
        return { staff, held: ids.filter((id) => staff.querySelector(`[id="${id}"]`) !== null) };
      });
      return {
        staves: new Set(found.map((f) => f.staff)).size,
        held: found.map((f) => f.held.length),
        ids: found.flatMap((f) => f.held).sort(),
      };
    }, steps[6]!.ids);
    expect(placed.staves, 'one ring per staff').toBe(2);
    expect(placed.held, 'each staff holds one of the step').toEqual([1, 1]);
    expect(placed.ids).toEqual([...steps[6]!.ids].sort());
    expect(await walkTiming(page).markCount()).toBe(1);
    await expect(status(page)).not.toHaveText(EXPLAIN);
    await expectOneRed(page, 'a replayed bar');
  });

  test('Play clears the rings, and a seek keeps them', async ({ page }) => {
    const { midi, steps } = await twinkle(page);
    await rushedBar(page);
    await expect(rings(page)).toHaveCount(1);

    // A click on bar 3 moves the red there: the chain breaks, the ring stays.
    const bar3 = steps.findIndex((s) => s.bar === 3);
    expect(bar3).toBeGreaterThan(0);
    await seekBar(page, 3);
    await expect.poll(() => midi.index()).toBe(bar3);
    await midi.waitForStep();
    await expect(rings(page)).toHaveCount(1);
    expect(await walkTiming(page).markCount()).toBe(1);

    // Play plays the song and judges nothing; the ring goes.
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(rings(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
    await expect(rings(page)).toHaveCount(0);
    expect(await walkTiming(page).markCount()).toBe(0);
    await expectOneRed(page, 'after Play');
  });

  for (const [width, height] of [
    [360, 800],
    [1280, 900],
  ] as const) {
    test.describe(`at ${width} px`, () => {
      test.use({ viewport: { width, height } });

      for (const scheme of ['light', 'dark'] as const) {
        test(`in the ${scheme} theme the ring is gray, clear of the digits, one red`, async ({
          page,
        }) => {
          test.setTimeout(120_000);
          await page.emulateMedia({ colorScheme: scheme });
          await twinkle(page);
          await rushedBar(page);
          await expect(rings(page, 'early')).toHaveCount(1);
          const label = `${scheme}, ${width} px`;
          expect(await horizontalOverflow(page), `${label} overflow`).toBeLessThanOrEqual(0);
          const roots = await expectOneRed(page, label);
          expect(roots.every((r) => r.inSheet)).toBe(true);
          await expectNoSeriousA11y(page, label);

          const seen = await page.evaluate(() => {
            const svg = document.querySelector('.score-sheet svg')!;
            const probe = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            probe.style.stroke = 'var(--gray-3)';
            svg.appendChild(probe);
            const gray = getComputedStyle(probe).stroke;
            probe.remove();
            const circles = [...document.querySelectorAll('.timing-mark circle')];
            const box = (el: Element) => el.getBoundingClientRect();
            const digits = [...document.querySelectorAll('.score-sheet g.fing')].map(box);
            const touching = circles.filter((ring) => {
              const r = box(ring);
              return digits.some(
                (d) => r.left < d.right && d.left < r.right && r.top < d.bottom && d.top < r.bottom,
              );
            }).length;
            return {
              gray,
              strokes: circles.map((ring) => getComputedStyle(ring).stroke),
              touching,
            };
          });
          expect(seen.strokes).toHaveLength(1);
          for (const stroke of seen.strokes) expect(stroke).toBe(seen.gray);
          expect(seen.gray).toBe(scheme === 'light' ? 'rgb(118, 118, 118)' : 'rgb(140, 140, 140)');
          expect(seen.touching, `${label}: rings touching a fingering digit`).toBe(0);

          // Printed pages carry no ring.
          await page.emulateMedia({ media: 'print' });
          await expect(page.locator('.timing-mark')).toBeHidden();
          await page.emulateMedia({ media: 'screen' });

          // The owner's screenshots: the music from its first system, with the dock and its line
          // below (a full-page shot would leave the sticky dock floating mid-page).
          if (!process.env.CI) {
            await page.evaluate(() =>
              document
                .querySelector('.score-sheet svg g.system')
                ?.scrollIntoView({ block: 'start' }),
            );
            mkdirSync('build/timing-marks', { recursive: true });
            await page.screenshot({ path: `build/timing-marks/${scheme}-${width}.png` });
          }
        });
      }
    });
  }
});
