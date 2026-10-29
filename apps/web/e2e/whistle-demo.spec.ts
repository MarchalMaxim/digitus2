import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { libraryReady } from './helpers/library.js';
import { expectDigits } from './helpers/sheet.js';
import { fakeMicrophone, traceInk } from './helpers/whistle.js';

// The walk-through of Whistle a tune (issue 237) as a video, and a screenshot of each stage in both
// themes and at both widths, for a person to look at. Not a gate and not in CI: it runs only when
// asked (DIGITUS2_E2E_DEMO=1), with short pauses so that the video can be followed. The files go to
// DIGITUS2_E2E_DEMO_OUT, by default test-results/whistle-demo.
test.skip(process.env.DIGITUS2_E2E_DEMO !== '1', 'asked for with DIGITUS2_E2E_DEMO=1');

const out =
  process.env.DIGITUS2_E2E_DEMO_OUT ??
  fileURLToPath(new URL('../test-results/whistle-demo/', import.meta.url));
mkdirSync(out, { recursive: true });
const file = (name: string) => `${out.replace(/[\\/]$/, '')}/${name}`;

test.use({
  launchOptions: { args: fakeMicrophone() },
  hasTouch: false,
  isMobile: false,
  viewport: { width: 1280, height: 800 },
});

const start = (page: Page) => page.getByRole('button', { name: 'Whistle a tune' });
const recording = (page: Page) => page.getByRole('group', { name: 'Recording' });
/** A pause for the person watching the video, not for the page. */
const beat = (page: Page, ms = 1500) => page.waitForTimeout(ms);

/** Starts a recording; the time it began to listen, by the clock of Date.now. */
async function record(page: Page): Promise<number> {
  await start(page).click();
  await expect(recording(page)).toBeVisible();
  const listening = Date.now();
  await expect.poll(() => traceInk(page), { timeout: 20_000 }).toBeGreaterThan(0);
  return listening;
}
async function stopAt(page: Page, seconds: string) {
  await expect(recording(page)).toContainText(seconds, { timeout: 20_000 });
  await recording(page).getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('heading', { name: 'Recording' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Use for fingerings' })).toBeEnabled();
  await expect(page.locator('.scan-sheet')).toHaveAttribute('aria-busy', 'false');
}

test('the video: whistle, review, correct, finger, keep', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    serviceWorkers: 'block',
    recordVideo: { dir: file('video'), size: { width: 1280, height: 800 } },
  });
  const page = await context.newPage();
  // The video starts with the page; the soundtrack is placed by this clock.
  const filmed = Date.now();
  await page.goto('/');
  await libraryReady(page);
  await expect(start(page)).toBeVisible();
  await beat(page, 2500);

  const listening = await record(page);
  await beat(page, 4000);
  await stopAt(page, '0:06');
  await beat(page, 1500);

  // The recording the review keeps, played once in its player: the browser's sound is muted and
  // a video has none, so the recording and the two moments it is heard are saved for a soundtrack.
  const wav = await page.locator('audio').evaluate(async (audio: HTMLAudioElement) => {
    const bytes = new Uint8Array(await (await fetch(audio.src)).arrayBuffer());
    return Array.from(bytes);
  });
  writeFileSync(file('whistle-demo-sound.wav'), Uint8Array.from(wav));
  const played = Date.now();
  await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.play());
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.ended), {
      timeout: 20_000,
    })
    .toBe(true);
  writeFileSync(
    file('whistle-demo-sound.json'),
    JSON.stringify({ heardMs: [listening - filmed, played - filmed] }),
  );
  await beat(page, 1500);

  // A note is wrong: raise the last one a step.
  await page.locator('.scan-sheet [id="s7"]').click({ force: true });
  await beat(page, 1500);
  await page.locator('.scan-sheet').focus();
  await page.keyboard.press('ArrowUp');
  await beat(page, 2500);
  await page.keyboard.press('Escape');
  await beat(page, 1500);

  await page.getByRole('button', { name: 'Use for fingerings' }).click();
  await expectDigits(page, 8);
  await beat(page, 3500);

  await page.getByRole('button', { name: /^Back to (the )?library$/ }).click();
  await libraryReady(page);
  await page.getByText('My scores', { exact: true }).click();
  await expect(page.getByRole('button', { name: /^Open saved Whistled tune / })).toBeVisible();
  await beat(page, 2500);
  await page.getByRole('button', { name: /^Open saved Whistled tune / }).click();
  await expect(page.getByRole('heading', { name: 'Recording' })).toBeVisible();
  await beat(page, 3000);

  const video = page.video();
  await context.close();
  await video?.saveAs(file('whistle-demo.webm'));
});

for (const scheme of ['light', 'dark'] as const) {
  for (const width of [1280, 360]) {
    test(`screenshots at ${width} px, ${scheme}`, async ({ browser }) => {
      const context = await browser.newContext({
        colorScheme: scheme,
        viewport: { width, height: width === 360 ? 740 : 800 },
        serviceWorkers: 'block',
      });
      const page = await context.newPage();
      const shot = (stage: string, fullPage = false) =>
        page.screenshot({ path: file(`whistle-${stage}-${width}-${scheme}.png`), fullPage });
      await page.goto('/');
      await libraryReady(page);
      await expect(start(page)).toBeVisible();
      await start(page).scrollIntoViewIfNeeded();
      await shot('1-library');

      await record(page);
      await expect(recording(page)).toContainText('0:03', { timeout: 20_000 });
      await recording(page).scrollIntoViewIfNeeded();
      await shot('2-recording');

      await stopAt(page, '0:06');
      await shot('3-review', true);

      await page.getByRole('button', { name: 'Use for fingerings' }).click();
      await expectDigits(page, 8);
      await shot('4-score');
      await context.close();
    });
  }
}
