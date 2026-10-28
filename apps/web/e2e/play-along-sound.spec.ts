import { expect, test, type Page } from '@playwright/test';
import { audioState, fakeMidi, installFakeMidi, quietly } from './helpers/midi.js';
import { horizontalOverflow } from './helpers/overflow.js';
import { expectOneRed } from './helpers/red.js';
import { delayPianoSamples } from './helpers/samples.js';

// Playing along with the other hand (issue 184) and the browser's autoplay policy. A browser
// lets an AudioContext run only once the page has had a click or a key press (sticky user
// activation); a MIDI message is neither. So on a fresh load straight onto a score URL the walk
// works fully, the red moves on every press, and the sound waits for one click, which the status
// line asks for. After a click on a piece in the library the page has had one, and the sound runs.
//
// Every other spec passes `--autoplay-policy=no-user-gesture-required` (playwright.config.ts) so
// that no ordinary flow meets a suspended context. This one asks for the real policy, and its
// launch arguments are worker-scoped: the spec gets a browser of its own. Headless Chromium may
// not keep the policy faithfully, so the authoritative check is the same spec in the person's own
// Chrome with real audio: `DIGITUS2_E2E_CHROME=1` switches to channel chrome, headed, unmuted.
//
// Playwright evaluates in the page with a user gesture, which is itself a user activation (see
// `quietly` in helpers/midi.ts), and so does its trace. Until the click the flow reads the page
// with `quietly`, and it keeps away from locators, `expect(locator)` and screenshots, which
// would activate it.

const realChrome = process.env.DIGITUS2_E2E_CHROME === '1';
test.use({
  // The trace (the config keeps one for a failed test) takes snapshots through the page with a
  // user gesture, which activates the document too: this spec records none.
  trace: 'off',
  ...(realChrome ? { channel: 'chrome' as const, headless: false } : {}),
  launchOptions: {
    args: [
      '--autoplay-policy=document-user-activation-required',
      ...(realChrome ? [] : ['--mute-audio']),
    ],
  },
});

const TWINKLE = 'twinkle-twinkle-little-star';
const TWINKLE_NOTES = 64;
const CLICK = 'Click the page once to hear the other hand.';

interface Counted {
  __sources: number;
  __contexts: AudioContext[];
}

/**
 * Counts every `AudioBufferSourceNode.start` of the page (the voices smplr starts) and keeps the
 * page's AudioContexts, so what really sounds is observed with no hook of the app's.
 */
async function watchAudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Counted;
    w.__sources = 0;
    w.__contexts = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (
      this: AudioBufferSourceNode,
      ...args: Parameters<AudioBufferSourceNode['start']>
    ) {
      w.__sources++;
      return start.apply(this, args);
    };
    const Real = window.AudioContext;
    window.AudioContext = class extends Real {
      constructor(options?: AudioContextOptions) {
        super(options);
        w.__contexts.push(this);
      }
    };
  });
}

/**
 * Records, from the first mutation on, whether the status line ever said `sentence`: a flash
 * while a permitted context starts shows only to a recorder, never to a check at one instant.
 */
async function watchStatus(page: Page, sentence: string): Promise<void> {
  await page.addInitScript((text) => {
    const w = window as unknown as { __saidClick: boolean };
    w.__saidClick = false;
    new MutationObserver(() => {
      const line = document.querySelector('.dock [role="status"]');
      if (line?.textContent?.trim() === text) w.__saidClick = true;
    }).observe(document, { subtree: true, childList: true, characterData: true });
  }, sentence);
}
const saidClick = (page: Page): Promise<boolean> =>
  page.evaluate(() => (window as unknown as { __saidClick: boolean }).__saidClick);

const sources = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as Counted).__sources);
const contexts = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as Counted).__contexts.map((c) => c.state));
/** The status line's words, read without a locator. */
const statusLine = (page: Page): Promise<string> =>
  page.evaluate(
    () =>
      document.querySelector('.dock [role="status"]')?.textContent?.trim() ?? '<no status line>',
  );
const activated = (page: Page): Promise<boolean> =>
  page.evaluate(() => navigator.userActivation.hasBeenActive);

test('a fresh load straight onto a score: the walk works, the sound waits for one click', async ({
  page,
}) => {
  await watchAudio(page);
  await delayPianoSamples(page, 0);
  await installFakeMidi(page, {
    permission: 'granted',
    playAlong: true,
    settings: { hands: 'R' }, // seeded: a click on the Practice panel would be a user activation
  });
  await page.goto(`/?hooks=1#/piece/${TWINKLE}`);
  const loud = await quietly(page);
  const midi = fakeMidi(page);

  // The score is ready and the walk waits on the first step: the right hand's 60.
  await expect
    .poll(() => page.evaluate(() => document.querySelectorAll('.score-sheet g.fing').length), {
      timeout: 20_000,
    })
    .toBe(TWINKLE_NOTES);
  expect(await midi.waitForStep()).toEqual([60]);
  // The premise: the page has had no click, no key, and Playwright has not given it one.
  expect(await activated(page)).toBe(false);

  // The context exists (the samples load for the other hand) and the browser holds it.
  await expect.poll(() => audioState(page)).toBe('suspended');
  await expect.poll(() => statusLine(page)).toBe(CLICK);
  expect(await activated(page)).toBe(false);
  await expectOneRed(page, 'a fresh load, the sound waiting');

  // The walk works fully: the red moves on every press, through the step whose stretch the left
  // hand plays in (step 4, the A at 2.4 s), and nothing sounds. Nothing queued waits to sound
  // all at once on the click either: `accompany` is a no-op while the context is held.
  for (let i = 0; i < 6; i++) await midi.playRed();
  expect(await midi.index()).toBe(6);
  expect(await sources(page)).toBe(0);
  expect(await audioState(page)).toBe('suspended');
  expect(await statusLine(page)).toBe(CLICK);
  expect(await activated(page)).toBe(false);
  await expectOneRed(page, 'six steps, still waiting for the click');

  // The sentence fits a phone, too (the page is not made wider by it).
  await page.setViewportSize({ width: 360, height: 740 });
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  await expectOneRed(page, 'at 360 px');
  await page.setViewportSize({ width: 1280, height: 900 });

  // One click anywhere on the page: the capture listener resumes the context.
  const title = await page.evaluate(() => {
    const r = document.querySelector('h1')!.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(title.x, title.y);
  loud();
  await expect.poll(() => audioState(page)).toBe('running');
  expect(await contexts(page)).toEqual(['running']);
  await expect(page.getByRole('status')).not.toHaveText(CLICK);

  // The next steps with a left-hand note sound: step 6 (3.6 s) and step 7 (4.8 s).
  for (let i = 0; i < 4 && (await sources(page)) === 0; i++) await midi.playRed();
  await expect.poll(() => sources(page)).toBeGreaterThan(0);
  await expectOneRed(page, 'after the click, the left hand sounding');
});

test('after the click that opens a piece from the library: no sentence, and the other hand sounds', async ({
  page,
}) => {
  await watchAudio(page);
  await watchStatus(page, CLICK);
  await delayPianoSamples(page, 0);
  await installFakeMidi(page, {
    permission: 'granted',
    playAlong: true,
    settings: { hands: 'R' },
  });
  await page.goto('/?hooks=1');
  const loud = await quietly(page);

  // The library page, read without a locator: nothing has activated the document yet. The red
  // button of a first visit opens the first piece of the lowest grade, Twinkle.
  const start = () =>
    page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find((b) =>
        /^(Start|Continue) with /.test(b.textContent ?? ''),
      );
      if (!button) return null;
      const r = button.getBoundingClientRect();
      return { text: button.textContent ?? '', x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
  await expect.poll(start, { timeout: 20_000 }).not.toBeNull();
  expect(await activated(page)).toBe(false);
  const at = (await start())!;
  // The test follows Twinkle, the first piece of the lowest grade: if the library's first piece
  // ever changes, this says why.
  expect(at.text).toBe('Start with Twinkle, Twinkle, Little Star');

  // The click on the piece is the page's first activation; the piece opens by an in-app
  // navigation, and the context that `prepare` makes in an effect runs.
  await page.mouse.click(at.x, at.y);
  // Read through the quiet evaluate: a loud one would activate the page itself.
  expect(await activated(page)).toBe(true);
  loud();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(`#/piece/${TWINKLE}`);
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(TWINKLE_NOTES, {
    timeout: 20_000,
  });
  const midi = fakeMidi(page);
  await midi.waitForStep();
  await expect.poll(() => audioState(page)).toBe('running');
  await expect(page.getByRole('status')).not.toHaveText(/Loading the piano/, { timeout: 20_000 });
  for (let i = 0; i < 8 && (await sources(page)) === 0; i++) await midi.playRed();
  await expect.poll(() => sources(page)).toBeGreaterThan(0);
  // The sentence never showed, not even for the instant a permitted context takes to start.
  expect(await saidClick(page)).toBe(false);
  await expectOneRed(page, 'from the library, the left hand sounding');
});
