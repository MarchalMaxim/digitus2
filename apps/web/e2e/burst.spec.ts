import { expect, test, type Page } from '@playwright/test';
import { closePractice, embellishDecided, openPractice } from './helpers/practice.js';
import { expectOneRed } from './helpers/red.js';
import { redSettled, seekBar } from './helpers/seek.js';

// The easter egg (NoteBurst.tsx, motion study 10): a click on nothing in particular lets a few
// notes rise at their full size (T18: the global `svg { max-width: 100% }` rule once squeezed
// them to 6 px wide), and a drag across the page, as when selecting text, adds none.
test('a click on nothing lets full-size notes rise; a drag adds none', async ({ page }) => {
  await page.goto('/#/piece/twinkle-twinkle-little-star');
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
  const title = await page.getByRole('heading', { level: 1 }).boundingBox();
  expect(title).not.toBeNull();
  // Blank space to the right of the title.
  const x = title!.x + title!.width + 120;
  const y = title!.y + title!.height / 2;

  await page.mouse.click(x, y);
  const notes = page.locator('.note-burst-note svg');
  await expect(notes.first()).toBeAttached();
  const size = await notes.first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return [cs.width, cs.height];
  });
  expect(size).toEqual(['25px', '28px']);
  const bursts = await page.locator('.note-burst').count();
  expect(bursts).toBe(1);

  await page.mouse.move(x - 100, y);
  await page.mouse.down();
  await page.mouse.move(x + 100, y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  expect(await page.locator('.note-burst').count()).toBe(1);
});

// The finish (issue 97 and issue 193, score/EndBurst.tsx): when the piece has been played to its end, 6 to 8
// ink notes rise from the last group heard as the red flies home to Play. Twinkle, cued to its
// last bar at 150 % with no count-in, ends about two seconds after Play.
async function cueLastBar(page: Page): Promise<number> {
  await page.goto('/?audio=silent#/piece/twinkle-twinkle-little-star');
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled();
  await openPractice(page);
  await embellishDecided(page);
  await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
  await page.getByRole('slider', { name: 'Tempo' }).fill('150');
  await closePractice(page);
  const last = (await page.locator('.score-sheet g.measure').count()) - 1;
  await seekBar(page, last);
  await redSettled(page);
  return last;
}

test('at the end of the piece, ink notes rise from the final notes as the red flies home', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'a mouse flow');
  const last = await cueLastBar(page);
  const burstNotes = page.locator('.end-burst .note-burst-note');
  await expect(burstNotes).toHaveCount(0);
  await page.getByRole('button', { name: 'Play' }).click();
  // Exactly one red on every sample until the finish rises: the cursor, then the flying red.
  const deadline = Date.now() + 10_000;
  while ((await burstNotes.count()) === 0) {
    expect(Date.now(), 'the finish did not rise').toBeLessThan(deadline);
    await expectOneRed(page, 'playing the last bar');
  }
  const count = await burstNotes.count();
  expect(count).toBeGreaterThanOrEqual(6);
  expect(count).toBeLessThanOrEqual(8);
  // It rises from the last bar, in ink only, while the red flies home (then Play has it).
  const bar = await page.locator('.score-sheet g.measure').nth(last).boundingBox();
  const at = await page.locator('.end-burst .note-burst').evaluate((el) => ({
    x: parseFloat(el.style.left),
    y: parseFloat(el.style.top),
  }));
  expect(at.x).toBeGreaterThanOrEqual(bar!.x);
  expect(at.x).toBeLessThanOrEqual(bar!.x + bar!.width);
  expect(at.y).toBeGreaterThanOrEqual(bar!.y);
  expect(at.y).toBeLessThanOrEqual(bar!.y + bar!.height);
  await expect(page.locator('.end-burst .is-red')).toHaveCount(0);
  const until = Date.now() + 700;
  while (Date.now() < until) await expectOneRed(page, 'the finish');
  await expect(page.getByRole('button', { name: 'Play' })).toHaveClass(/is-red/);
  await expect(page.locator('.end-burst .note-burst')).toHaveCount(1); // once per play-through
  const roots = await expectOneRed(page, 'ended');
  expect(roots[0]!.tag).toBe('button');
});

test('under reduced motion the piece ends with no finish', async ({ page, isMobile }) => {
  test.skip(isMobile, 'a mouse flow');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await cueLastBar(page);
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play' })).toHaveClass(/is-red/, {
    timeout: 10_000,
  });
  await expect(page.locator('.end-burst .note-burst')).toHaveCount(0);
  await expectOneRed(page, 'ended under reduced motion');
});

// Issue 171: at the end the transport rewinds before React hears it stopped; on a slow CPU a
// frame lands in that gap, reads the start and marked bar 1, where the finish then rose.
test('at the end of the piece on a slow CPU (8x throttled), the finish still rises from the last bar', async ({
  page,
  isMobile,
  browserName,
}) => {
  test.skip(isMobile, 'a mouse flow');
  test.skip(browserName !== 'chromium', 'CPU throttling is a Chromium DevTools feature');
  test.setTimeout(120_000);
  const last = await cueLastBar(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 8 });
  try {
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.locator('.end-burst .note-burst-note').first()).toBeAttached({
      timeout: 60_000,
    });
    const at = await page.locator('.end-burst .note-burst').evaluate((el) => ({
      x: parseFloat(el.style.left),
      y: parseFloat(el.style.top),
    }));
    const bar = await page.locator('.score-sheet g.measure').nth(last).boundingBox();
    const where = JSON.stringify({ at, bar });
    expect(at.x, where).toBeGreaterThanOrEqual(bar!.x);
    expect(at.x, where).toBeLessThanOrEqual(bar!.x + bar!.width);
    expect(at.y, where).toBeGreaterThanOrEqual(bar!.y);
    expect(at.y, where).toBeLessThanOrEqual(bar!.y + bar!.height);
  } finally {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
});
