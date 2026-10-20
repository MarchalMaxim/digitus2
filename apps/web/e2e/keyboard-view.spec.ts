import { expect, test } from '@playwright/test';

// A keyboard wider than its column keeps its view for a bar (issue #104): Horse Race has a stride
// bass, the left hand leaping a tenth and more on every eighth under the right hand's chords two
// octaves up, wider than a phone's keyboard shows. Choosing the view at every onset swung it from
// bass to treble several times a bar; it moves at most once a bar now, and the dock stays put.

const HORSE_RACE = 'pdmx-horse-race-2f08957f';
/** Bars the cursor enters before the checks: a phrase of the stride. */
const BARS = 8;

test('a scrolling keyboard moves at most once a bar under a stride bass', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(`/?audio=silent#/piece/${HORSE_RACE}`);
  await expect(page.locator('.score-sheet g.fing').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled();
  const scrolls = await page
    .locator('.keyboard-scroll')
    .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  test.skip(!scrolls, 'the whole keyboard fits this width');
  await page.getByRole('button', { name: 'Play' }).click();
  const seen = await page.evaluate(
    async ({ bars }) => {
      const scroller = document.querySelector('.keyboard-scroll')!;
      const dock = document.querySelector('.dock')!;
      const measures: string[] = [];
      const dockHeights = new Set<number>();
      let moves = 0;
      let last = scroller.scrollLeft;
      const deadline = performance.now() + 60_000;
      await new Promise<void>((resolve) => {
        const frame = () => {
          const red = document.querySelector('.score-sheet .is-red');
          const measure = red?.closest('g.measure')?.id;
          if (measure) {
            if (measures.at(-1) !== measure) measures.push(measure);
            dockHeights.add(Math.round(dock.getBoundingClientRect().height));
            if (scroller.scrollLeft !== last) moves++;
          }
          last = scroller.scrollLeft;
          if (measures.length > bars || performance.now() > deadline) resolve();
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      return { bars: measures.length, moves, dockHeights: [...dockHeights] };
    },
    { bars: BARS },
  );
  expect(seen.bars, 'bars the cursor entered').toBeGreaterThan(BARS);
  expect(seen.moves, 'keyboard scrolls while the cursor crossed the bars').toBeLessThanOrEqual(
    seen.bars,
  );
  expect(seen.dockHeights, 'dock heights while playing').toHaveLength(1);
});
