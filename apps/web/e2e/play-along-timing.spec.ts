import { mkdirSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectNoSeriousA11y } from './helpers/axe.js';
import {
  fakeMidi,
  installFakeMidi,
  playAlongTimed,
  timedHearings,
  timingHook,
  type JudgementView,
  type TimedPlan,
  type TimingStepView,
} from './helpers/midi.js';
import { horizontalOverflow } from './helpers/overflow.js';
import { closePractice, embellishDecided, openPractice, setLoopBars } from './helpers/practice.js';
import { expectOneRed } from './helpers/red.js';

// Timing feedback after a run of Play (issue 192). With the fake piano connected and Practice
// mode on, Play is the reader's run: `playAlongTimed` (helpers/midi.ts) plays along in the page
// with set offsets, stamping each note-on with the instant it aims at, and the run is judged at
// the Pause. Twinkle at 75 %: the beat is 800 ms real, so the tolerance is 200 ms, the match
// window's half-width 600 ms real (cut to 400 ms at a same-pitch neighbour) and the bias search
// 800 ms; offsets of 300 ms are 100 ms clear of the tolerance and of every window edge. The
// count-in is off, so the first beat of a run judges no lateness (the reader reacts to it).
//
// Twinkle's steps (both hands) start [48 60] [60] [67] [67] [53 69] [69] [48 67] [53 65] [65]
// [48 64] [64]: the left hand plays 48, 53 and 55, the right hand the tune.

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
const SUMMARY = /^(\d+) of (\d+) notes on time\. The rings show the others\.$/;
const ALL_ON_TIME_FASTER = 'Every note on time. Try it a little faster.';
const HINT_ONE = 'Play the red note on your piano.';
const HINT_MANY = 'Play the red notes on your piano.';

const status = (page: Page): Locator => page.locator('.dock [role="status"]');
const marks = (page: Page, verdict?: string): Locator =>
  page.locator(verdict ? `.timing-mark[data-timing="${verdict}"]` : '.timing-mark');

/** Twinkle at 75 % with the count-in off and the fake piano connected; the walk on its first step. */
async function twinkle(page: Page): Promise<{
  midi: ReturnType<typeof fakeMidi>;
  steps: TimingStepView[];
}> {
  await installFakeMidi(page, {
    permission: 'granted',
    playAlong: true,
    settings: { countIn: false },
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
  const steps = await timingHook(page).steps();
  expect(steps.slice(0, FIRST_STEPS.length).map((s) => s.pitches)).toEqual(FIRST_STEPS);
  return { midi, steps };
}

/** The walk waits on the piece's first step again (after Rewind, or at the start). */
async function atFirstStep(page: Page, midi: ReturnType<typeof fakeMidi>): Promise<void> {
  await midi.waitForStep();
  await expect.poll(() => midi.index()).toBe(0);
}

/**
 * Case 1's run: steps 0 to 10, step 2 at -300 ms (right hand only, no 67 before it), step 5 at
 * +300 ms (right hand only), step 7 not played (both hands), and Pause one beat after step 10.
 */
function slipsPlan(steps: TimingStepView[]): TimedPlan {
  return {
    play: true,
    passes: [{ fromSec: steps[0]!.perfSec, toSec: null }],
    hearings: timedHearings(
      steps.slice(0, 11).map((_, i) => i),
      { offsets: { 2: -300, 5: 300 }, skip: [7] },
    ),
    pauseAt: { pass: 0, perfSec: steps[10]!.perfSec + 0.6 },
  };
}

/** What case 1 must give, by unit key: step 2 early, step 5 late, step 7 missed in both hands. */
function slipsVerdicts(steps: TimingStepView[]): Record<string, string> {
  expect(steps[2]!.parts.map((p) => p.hand)).toEqual(['R']);
  expect(steps[5]!.parts.map((p) => p.hand)).toEqual(['R']);
  expect(steps[7]!.parts.map((p) => p.hand)).toEqual(['L', 'R']);
  const out: Record<string, string> = {};
  steps.slice(0, 11).forEach((step, i) => {
    for (const part of step.parts) {
      out[part.key] = i === 7 ? 'missed' : i === 2 ? 'early' : i === 5 ? 'late' : 'onTime';
    }
  });
  return out;
}

/** The early and late rings' centres against their noteheads', in px. */
function ringShifts(page: Page, judgement: JudgementView) {
  const units = judgement.verdicts
    .filter((v) => v.verdict === 'early' || v.verdict === 'late')
    .map((v) => ({ id: v.ids[0]!, verdict: v.verdict }));
  return page.evaluate(
    (list) =>
      list.map(({ id, verdict }) => {
        const head = document.querySelector(`[id="${id}"] g.notehead`)!;
        const ring = head
          .closest('g.staff')!
          .querySelector(`.timing-mark[data-timing="${verdict}"] circle`)!;
        const h = head.getBoundingClientRect();
        const r = ring.getBoundingClientRect();
        return { verdict, dx: r.left + r.width / 2 - (h.left + h.width / 2), w: h.width };
      }),
    units,
  );
}

/** The red draws a notehead this much larger (base.css, `.is-red .notehead`). */
const RED_HEAD_SCALE = 1.4;

/**
 * The rings that touch a notehead, every head measured as large as the red draws it, since the red
 * can land on any note after the run. A missed ring goes around its own head: that head must fit
 * inside it; any other head must stay clear of its box.
 */
function ringsOnHeads(page: Page): Promise<string[]> {
  return page.evaluate((scale) => {
    const heads = [...document.querySelectorAll('.score-sheet g.notehead')].map((el) => {
      const b = el.getBoundingClientRect();
      const k = el.closest('.is-red') ? 1 : scale;
      return {
        id: el.closest('g.note')?.id ?? '?',
        x: b.left + b.width / 2,
        y: b.top + b.height / 2,
        hw: (b.width * k) / 2,
        hh: (b.height * k) / 2,
      };
    });
    const out: string[] = [];
    for (const ring of document.querySelectorAll('.timing-mark')) {
      const verdict = ring.getAttribute('data-timing');
      const b = ring.querySelector('circle')!.getBoundingClientRect();
      const r = b.width / 2;
      const x = b.left + r;
      const y = b.top + b.height / 2;
      for (const h of heads) {
        if (verdict === 'missed' && Math.hypot(h.x - x, h.y - y) < r) {
          if (h.hw >= r) out.push(`the missed ring around ${h.id} is inside its red head`);
        } else if (Math.abs(h.x - x) < h.hw + r && Math.abs(h.y - y) < h.hh + r) {
          out.push(`the ${verdict} ring touches ${h.id}`);
        }
      }
    }
    return out;
  }, RED_HEAD_SCALE);
}

/** Case 1's end state, judged and drawn: the verdicts, the rings and the line. */
async function expectSlips(page: Page, steps: TimingStepView[]): Promise<JudgementView> {
  await expect(marks(page)).toHaveCount(4);
  const judgement = (await timingHook(page).judgement())!;
  expect(judgement).not.toBeNull();
  expect(Object.fromEntries(judgement.verdicts.map((v) => [v.key, v.verdict]))).toEqual(
    slipsVerdicts(steps),
  );
  expect(Math.abs(judgement.biasMs), `bias ${judgement.biasMs} ms`).toBeLessThanOrEqual(60);

  await expect(marks(page, 'early')).toHaveCount(1);
  await expect(marks(page, 'late')).toHaveCount(1);
  await expect(marks(page, 'missed')).toHaveCount(2);
  const missedStaves = await marks(page, 'missed').evaluateAll(
    (els) => new Set(els.map((el) => el.closest('g.staff'))).size,
  );
  expect(missedStaves, 'the two missed rings are on different staves').toBe(2);

  await expect(status(page)).toHaveText(SUMMARY);
  const [, onTime, total] = SUMMARY.exec((await status(page).textContent()) ?? '')!;
  expect(Number(total)).toBe(judgement.total);
  expect(Number(onTime)).toBe(judgement.total - 4);

  for (const { verdict, dx, w } of await ringShifts(page, judgement)) {
    if (verdict === 'early') expect(dx, 'the early ring sits left').toBeLessThanOrEqual(-w + 0.5);
    else expect(dx, 'the late ring sits right').toBeGreaterThanOrEqual(w - 0.5);
  }
  expect(await ringsOnHeads(page), 'rings touching a notehead, red or not').toEqual([]);
  return judgement;
}

test.describe('timing after a run of Play', () => {
  test('rings beside the early and late notes and around the missed ones, and one line', async ({
    page,
  }) => {
    const { steps } = await twinkle(page);
    const report = await playAlongTimed(page, slipsPlan(steps));
    expect(report.pausedAxis).not.toBeNull();
    expect(report.sent.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 8, 9, 10]);
    await expectSlips(page, steps);

    // Each logged press carries the time its key went down, never after it arrived: the stamp the
    // helper put on the MIDI event itself, carried through the parser and the store, not the
    // arrival (the stamps are aimed at instants already gone, so arrival comes later).
    const presses = await timingHook(page).presses();
    expect(presses.length).toBeGreaterThan(0);
    for (const p of presses) expect(p.atMs).toBeLessThanOrEqual(p.arrivalMs);
    for (const sent of report.sent) {
      for (const midi of sent.pitches) {
        const logged = presses.find((p) => p.midi === midi && Math.abs(p.atMs - sent.atMs) < 1e-6);
        expect(logged, `step ${sent.index}, ${midi}: logged with its event time`).toBeDefined();
      }
    }
    expect(presses.some((p) => p.arrivalMs - p.atMs > 0)).toBe(true);

    const roots = await expectOneRed(page, 'the rings after the run');
    expect(roots.every((r) => r.inSheet)).toBe(true);
    await expectNoSeriousA11y(page, 'the rings after the run');
  });

  test('every note on time: one line, no ring', async ({ page }) => {
    const { steps } = await twinkle(page);
    await playAlongTimed(page, {
      play: true,
      passes: [{ fromSec: steps[0]!.perfSec, toSec: null }],
      hearings: timedHearings(steps.slice(0, 9).map((_, i) => i)),
      pauseAt: { pass: 0, perfSec: steps[8]!.perfSec + 0.6 },
    });
    await expect(status(page)).toHaveText(ALL_ON_TIME_FASTER);
    await expect(marks(page)).toHaveCount(0);
    const judgement = (await timingHook(page).judgement())!;
    expect(judgement.verdicts.every((v) => v.verdict === 'onTime')).toBe(true);
    await expectOneRed(page, 'every note on time');
  });

  test('barely played: nothing shows, and the walk asks as before', async ({ page }) => {
    const { midi, steps } = await twinkle(page);
    await playAlongTimed(page, {
      play: true,
      passes: [{ fromSec: steps[0]!.perfSec, toSec: null }],
      hearings: [],
      pauseAt: { pass: 0, perfSec: steps[2]!.perfSec + 0.3 },
    });
    const cued = await midi.waitForStep();
    await expect(status(page)).toHaveText(cued.length > 1 ? HINT_MANY : HINT_ONE);
    await expect(marks(page)).toHaveCount(0);
    expect(await timingHook(page).judgement()).toBeNull();
  });

  test('Play clears them before any note; the hands and Practice mode off clear them too', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const { midi, steps } = await twinkle(page);
    await playAlongTimed(page, slipsPlan(steps));
    await expectSlips(page, steps);

    // Rewind moves the red: the line goes for good, the rings stay until the next Play.
    await page.getByRole('button', { name: 'Rewind' }).click();
    await atFirstStep(page, midi);
    await expect(status(page)).not.toHaveText(SUMMARY);
    await expect(marks(page)).toHaveCount(4);

    // The next Play: nothing of the last run is left as its first note goes out.
    const second = await playAlongTimed(page, slipsPlan(steps));
    expect(second.beforeFirstNote, 'frames before the first note').not.toBeNull();
    expect(second.beforeFirstNote!.marks).toBe(0);
    expect(second.beforeFirstNote!.status).toBe('');
    await expectSlips(page, steps);

    // A change of the hands played clears them.
    await openPractice(page);
    await page.getByRole('radio', { name: 'Right hand' }).check();
    await expect(marks(page)).toHaveCount(0);
    await expect(status(page)).not.toHaveText(SUMMARY);
    await page.getByRole('radio', { name: 'Both hands' }).check();
    await closePractice(page);
    await expect(marks(page)).toHaveCount(0);

    // A third run, then Practice mode off clears them.
    await page.getByRole('button', { name: 'Rewind' }).click();
    await atFirstStep(page, midi);
    await playAlongTimed(page, slipsPlan(steps));
    await expectSlips(page, steps);
    await openPractice(page);
    await page.getByRole('switch', { name: 'Practice mode' }).click();
    await expect(page.getByRole('switch', { name: 'Practice mode' })).not.toBeChecked();
    await closePractice(page);
    await expect(marks(page)).toHaveCount(0);
    await expect(status(page)).not.toHaveText(SUMMARY);
  });

  test.describe('a loop of bar 1', () => {
    /** The loop set, the walk on its first step; its stretch in performance seconds. */
    async function loopOne(page: Page) {
      const { midi, steps } = await twinkle(page);
      await setLoopBars(page, '1', '1');
      await closePractice(page);
      await atFirstStep(page, midi);
      // Bar 2 starts with a step ([53 69]): the loop runs from the first step to it.
      const stretch = { fromSec: steps[0]!.perfSec, toSec: steps[4]!.perfSec };
      return { steps, passes: [stretch, stretch, stretch, stretch] };
    }

    test('one slip in three passes is forgiven', async ({ page }) => {
      test.setTimeout(90_000);
      const { steps, passes } = await loopOne(page);
      const bar = [0, 1, 2, 3];
      const report = await playAlongTimed(page, {
        play: true,
        passes,
        hearings: [
          ...timedHearings(bar, { pass: 0, offsets: { 2: 300 } }),
          ...timedHearings(bar, { pass: 1 }),
          ...timedHearings(bar, { pass: 2 }),
        ],
        pauseAt: { pass: 3, perfSec: passes[3]!.fromSec + 0.3 },
      });
      expect(report.sent).toHaveLength(12);
      const judgement = (await timingHook(page).judgement())!;
      expect(judgement).not.toBeNull();
      const unit = judgement.verdicts.find((v) => v.key === steps[2]!.parts[0]!.key)!;
      expect(unit.hearings).toBe(3);
      expect(unit.verdict).toBe('onTime');
      expect(judgement.verdicts.map((v) => v.verdict)).toEqual(
        judgement.verdicts.map(() => 'onTime'),
      );
      expect(judgement.total).toBe(5); // [48 60] in two hands, then [60], [67], [67]
      await expect(status(page)).toHaveText(ALL_ON_TIME_FASTER);
      await expect(marks(page)).toHaveCount(0);
    });

    test('passes the reader sat out are not judged', async ({ page }) => {
      test.setTimeout(90_000);
      const { passes } = await loopOne(page);
      const bar = [0, 1, 2, 3];
      await playAlongTimed(page, {
        play: true,
        passes,
        hearings: [...timedHearings(bar, { pass: 0 }), ...timedHearings(bar, { pass: 1 })],
        pauseAt: { pass: 3, perfSec: passes[3]!.fromSec + 1.5 },
      });
      const judgement = (await timingHook(page).judgement())!;
      expect(judgement).not.toBeNull();
      expect(judgement.verdicts.some((v) => v.verdict === 'missed')).toBe(false);
      expect(judgement.total).toBe(5);
      expect(judgement.verdicts.every((v) => v.hearings === 2)).toBe(true);
      await expect(marks(page, 'missed')).toHaveCount(0);
      await expect(status(page)).toHaveText(ALL_ON_TIME_FASTER);
    });
  });

  for (const [width, height] of [
    [360, 800],
    [1280, 900],
  ] as const) {
    test.describe(`at ${width} px`, () => {
      test.use({ viewport: { width, height } });

      for (const scheme of ['light', 'dark'] as const) {
        test(`in the ${scheme} theme the rings are gray, clear of the digits, one red`, async ({
          page,
        }) => {
          await page.emulateMedia({ colorScheme: scheme });
          const { steps } = await twinkle(page);
          await playAlongTimed(page, slipsPlan(steps));
          await expectSlips(page, steps);
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
            const rings = [...document.querySelectorAll('.timing-mark circle')];
            const box = (el: Element) => el.getBoundingClientRect();
            const digits = [...document.querySelectorAll('.score-sheet g.fing')].map(box);
            const touching = rings.filter((ring) => {
              const r = box(ring);
              return digits.some(
                (d) => r.left < d.right && d.left < r.right && r.top < d.bottom && d.top < r.bottom,
              );
            }).length;
            return { gray, strokes: rings.map((ring) => getComputedStyle(ring).stroke), touching };
          });
          expect(seen.strokes).toHaveLength(4);
          for (const stroke of seen.strokes) expect(stroke).toBe(seen.gray);
          expect(seen.gray).toBe(scheme === 'light' ? 'rgb(118, 118, 118)' : 'rgb(140, 140, 140)');
          expect(seen.touching, `${label}: rings touching a fingering digit`).toBe(0);

          // The owner's screenshots (A17): the music from its first system, with the dock and its
          // line below (a full-page shot would leave the sticky dock floating mid-page).
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
