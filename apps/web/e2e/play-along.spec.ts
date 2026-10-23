import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectNoSeriousA11y } from './helpers/axe.js';
import { libraryReady } from './helpers/library.js';
import {
  accompCancelled,
  accompanied,
  audioState,
  fakeMidi,
  installFakeMidi,
  strikes,
  type AccompaniedNote,
  type FakeMidiOptions,
} from './helpers/midi.js';
import { closePractice, embellishDecided, openPractice, setLoopBars } from './helpers/practice.js';
import { expectOneRed } from './helpers/red.js';
import { delayPianoSamples, PIANO_SAMPLES } from './helpers/samples.js';
import { positionSec, redBars, redSettled, seekBar } from './helpers/seek.js';

// Playing along on the reader's own piano (issue 182): a digital piano over Web MIDI, here a
// fake that the test drives (helpers/midi.ts). The home line asks the browser only when pressed;
// in the score the red waits for the notes of the next group, and moves on when the reader holds
// them all. Twinkle's steps, in performance order, start [48 60] [60] [67] [67] [53 69] [69]
// [48 67] [53 65] [65] [48 64] [64] [55 62] [62] [48 60] (bars 1 to 4); every score flow runs
// with `?audio=silent`, and `strikes()` stays empty throughout: the app makes no sound for the
// reader's notes. With one hand left out, digitus plays that hand (issue 184) between the
// reader's steps, counted from the press that starts each step running; `accompanied()` and
// `accompCancelled()` read what it handed to the instrument and what it dropped (helpers/midi.ts).

const TWINKLE = 'twinkle-twinkle-little-star';
const TWINKLE_NOTES = 64;
const BWV994 = 'bach-applicatio-c-major-bwv-994';
/** The Practice tempo at its top, 150 %: every hold is two thirds as long (issue 185). */
const FAST = { [TWINKLE]: 1.5 };
const PIANO = 'GO:PIANO MIDI 1';

const START = 'Play along on your piano';
const TURN_OFF = 'Turn off';
const ASKING = 'Allow the browser to use your piano.';
const CONNECTED = `${PIANO} is connected. Open a piece and play the red note.`;
const NONE =
  'No piano found. Connect it with a USB cable, or pair it over Bluetooth and turn it on.';
const FLAG =
  'On Windows, a Bluetooth piano also needs chrome://flags/#use-winrt-midi-api set to Enabled.';
const DENIED =
  'The browser blocked MIDI for this site. Allow it in the site settings, then press again.';
const HINT_MANY = 'Play the red notes on your piano.';
const SEARCHING = 'Looking for your piano. Make sure it is turned on.';
const LOADING_THE_PIANO = 'Loading the piano…';
const HOLD_MANY = 'Hold the red notes a little longer.';

/** The home line's sentence (the library page has another status, the notice) and its button. */
const sentence = (page: Page): Locator => page.locator('.piano-line [role="status"]');
const pianoButton = (page: Page): Locator => page.locator('.piano-line button');

/** The stored `playAlong` setting, as the app persisted it. */
function storedSetting(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('digitus2.settings.v1');
    const stored = raw
      ? (JSON.parse(raw) as { state?: { settings?: { playAlong?: unknown } } })
      : null;
    return stored?.state?.settings?.playAlong;
  });
}

async function library(page: Page, fake?: FakeMidiOptions): Promise<void> {
  await installFakeMidi(page, fake);
  await page.goto('/');
  await libraryReady(page);
}

test.describe('the home line', () => {
  test('asks the browser only when pressed; the press is the consent', async ({ page }) => {
    await library(page, { answer: 'manual' });
    const midi = fakeMidi(page);
    const button = pianoButton(page);
    await expect(button).toHaveText(START);
    await expect(sentence(page)).toHaveText('');
    expect(await midi.requests(), 'requests on load').toBe(0);
    const roots = await expectOneRed(page, 'the library');
    expect(roots[0]!.tag).toBe('button');
    expect(roots[0]!.className).not.toContain('text-button');

    await button.click();
    await expect(sentence(page)).toHaveText(ASKING);
    await expect(button).toHaveText(START);
    await expect(button).toHaveAttribute('aria-busy', 'true');
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    // The browser is asked once the lazy chunk has loaded; no system exclusive messages.
    await expect.poll(() => midi.requests()).toBe(1);
    expect(await midi.requestOptions()).toEqual([{ sysex: false }]);
    await expectOneRed(page, 'asking');

    await midi.resolve('allow');
    await expect(sentence(page)).toHaveText(CONNECTED);
    await expect(button).toHaveText(TURN_OFF);
    await expect(button).not.toHaveAttribute('aria-busy');
    // The same element in every state: the focus survived every change of its label.
    await expect(button).toBeFocused();
    await expect(page.locator('.piano-line .is-red')).toHaveCount(0);
    const connected = await expectOneRed(page, 'connected');
    expect(connected[0]!.tag).toBe('button');
    await expectNoSeriousA11y(page, 'the piano connected');
  });

  test('with no piano it says how to connect one; the Windows flag only on Windows', async ({
    page,
  }) => {
    await library(page, { inputs: [], platform: 'Windows' });
    const midi = fakeMidi(page);
    await pianoButton(page).click();
    await expect(sentence(page)).toHaveText(`${NONE} ${FLAG}`);
    await expect(pianoButton(page)).toHaveText(TURN_OFF);
    await expectOneRed(page, 'no piano on Windows');
    await expectNoSeriousA11y(page, 'no piano on Windows');

    // A piano plugged in later is found with no reload, and when it goes the line says so again.
    // As in Chrome, the unplugged port stays in the list (disconnected) and comes back as the
    // same port; a browser that drops the port from the list is found again the same way.
    await midi.plug(PIANO);
    await expect(sentence(page)).toHaveText(CONNECTED);
    await midi.unplug();
    await expect(sentence(page)).toHaveText(`${NONE} ${FLAG}`);
    await expectOneRed(page, 'unplugged');
    await midi.plug(PIANO);
    await expect(sentence(page)).toHaveText(CONNECTED);
    await midi.remove();
    await expect(sentence(page)).toHaveText(`${NONE} ${FLAG}`);
    await midi.plug(PIANO);
    await expect(sentence(page)).toHaveText(CONNECTED);
    await expectOneRed(page, 'plugged in again');
  });

  test('without the Windows flag on another system', async ({ page }) => {
    await library(page, { inputs: [], platform: 'Linux' });
    await pianoButton(page).click();
    await expect(sentence(page)).toHaveText(NONE);
    await expectOneRed(page, 'no piano on Linux');
  });

  test('a block says the browser blocked MIDI, and the line can be pressed again', async ({
    page,
  }) => {
    await library(page, { answer: 'block' });
    const midi = fakeMidi(page);
    await pianoButton(page).click();
    await expect(sentence(page)).toHaveText(DENIED);
    await expect(pianoButton(page)).toHaveText(START);
    await expect(pianoButton(page)).not.toHaveAttribute('aria-disabled');
    expect(await midi.permission()).toBe('denied');
    expect(await storedSetting(page)).toBe(false);
    await expectOneRed(page, 'blocked');
    await expectNoSeriousA11y(page, 'blocked');
  });

  test('a dismissed prompt leaves the plain line', async ({ page }) => {
    await library(page, { answer: 'dismiss' });
    const midi = fakeMidi(page);
    await pianoButton(page).click();
    await expect.poll(() => midi.requests()).toBe(1);
    await expect(pianoButton(page)).not.toHaveAttribute('aria-busy');
    await expect(sentence(page)).toHaveText('');
    await expect(pianoButton(page)).toHaveText(START);
    expect(await midi.permission()).toBe('prompt');
    expect(await storedSetting(page)).toBe(false);
    await expectOneRed(page, 'dismissed');
  });

  test('Turn off is kept across a reload: the line is plain and the browser is not asked', async ({
    page,
  }) => {
    await library(page, { permission: 'granted' });
    const midi = fakeMidi(page);
    await pianoButton(page).click();
    await expect(sentence(page)).toHaveText(CONNECTED);
    expect(await storedSetting(page)).toBe(true);
    await pianoButton(page).click();
    await expect(pianoButton(page)).toHaveText(START);
    await expect(sentence(page)).toHaveText('');
    await expect(pianoButton(page)).toBeFocused();
    expect(await storedSetting(page)).toBe(false);

    await page.reload();
    await libraryReady(page);
    await expect(pianoButton(page)).toHaveText(START);
    await expect(sentence(page)).toHaveText('');
    expect(await midi.requests(), 'requests after the reload').toBe(0);
    await expectOneRed(page, 'turned off, reloaded');
  });

  test('a later visit connects with no press only when the permission is granted', async ({
    page,
  }) => {
    await library(page, { permission: 'granted', playAlong: true });
    const midi = fakeMidi(page);
    await expect(sentence(page)).toHaveText(CONNECTED);
    await expect(pianoButton(page)).toHaveText(TURN_OFF);
    expect(await midi.requests()).toBe(1);
    await expectOneRed(page, 'a later visit');
  });

  test('a later visit with the permission still to ask stays plain and does not ask', async ({
    page,
  }) => {
    await library(page, { permission: 'prompt', playAlong: true });
    const midi = fakeMidi(page);
    await expect(pianoButton(page)).toHaveText(START);
    await expect(sentence(page)).toHaveText('');
    expect(await midi.requests()).toBe(0);
    // The setting is still on: the reader's press asks, and the answer connects.
    await pianoButton(page).click();
    await expect(sentence(page)).toHaveText(CONNECTED);
    expect(await midi.requests()).toBe(1);
  });

  // Chrome's WinRT backend can leave requestMIDIAccess pending for 20 s or more while a Bluetooth
  // piano is off (issue 182). The fake's `hang` is that: the permission is granted, no answer.
  test('a request that stays pending says it is looking for the piano, and Turn off is ready', async ({
    page,
  }) => {
    await library(page, { permission: 'granted', hang: true });
    const midi = fakeMidi(page);
    const button = pianoButton(page);
    await button.click();
    await expect(sentence(page)).toHaveText(ASKING);
    await expect(button).toHaveAttribute('aria-busy', 'true');
    await expect.poll(() => midi.requests()).toBe(1);
    await expect(sentence(page)).toHaveText(SEARCHING, { timeout: 4_000 });
    await expect(button).toHaveText(TURN_OFF);
    await expect(button).not.toHaveAttribute('aria-busy');
    await expect(button).not.toHaveAttribute('aria-disabled');
    // The same element in every state: the focus never left the button.
    await expect(button).toBeFocused();
    await expect(page.locator('.piano-line .is-red')).toHaveCount(0);
    await expectOneRed(page, 'looking for the piano');
    await expectNoSeriousA11y(page, 'looking for the piano');

    await midi.resolve('allow');
    await expect(sentence(page)).toHaveText(CONNECTED);
    await expect(button).toHaveText(TURN_OFF);
    await expect(button).toBeFocused();
    await expectOneRed(page, 'found the piano');
  });

  test('a later visit whose request stays pending says so with no press; Turn off ends it for good', async ({
    page,
  }) => {
    await library(page, { permission: 'granted', playAlong: true, hang: true });
    const midi = fakeMidi(page);
    const button = pianoButton(page);
    await expect.poll(() => midi.requests()).toBe(1);
    await expect(sentence(page)).toHaveText(SEARCHING, { timeout: 4_000 });
    await expect(button).toHaveText(TURN_OFF);
    await expectOneRed(page, 'a later visit, looking');

    await button.click();
    await expect(button).toHaveText(START);
    await expect(sentence(page)).toHaveText('');
    await expect(button).toBeFocused();
    expect(await storedSetting(page)).toBe(false);
    // The browser answers late: the access is closed unused and the line stays plain.
    await midi.resolve('allow');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __fakeMidi: { access: unknown } }).__fakeMidi.access != null,
        ),
      )
      .toBe(true);
    await expect(sentence(page)).toHaveText('');
    await expect(button).toHaveText(START);
    await expectOneRed(page, 'turned off while looking');

    await page.reload();
    await libraryReady(page);
    await expect(pianoButton(page)).toHaveText(START);
    await expect(sentence(page)).toHaveText('');
    expect(await midi.requests(), 'requests after the reload').toBe(0);
  });

  test('with the browser prompt open the line keeps asking: nobody has said yes', async ({
    page,
  }) => {
    await library(page, { permission: 'prompt', answer: 'manual' });
    const midi = fakeMidi(page);
    await pianoButton(page).click();
    await expect.poll(() => midi.requests()).toBe(1);
    // Past the time a granted request would have been called searching, and a few polls beyond.
    const until = Date.now() + 4_000;
    while (Date.now() < until) {
      await expect(sentence(page)).toHaveText(ASKING);
      await expect(pianoButton(page)).toHaveAttribute('aria-busy', 'true');
      await page.waitForTimeout(250);
    }
    await expectOneRed(page, 'the prompt is open');
    await midi.resolve('allow');
    await expect(sentence(page)).toHaveText(CONNECTED);
  });

  test('without Web MIDI there is no line and no request', async ({ page }) => {
    await library(page, { unsupported: true });
    await expect(page.locator('.piano-line')).toHaveCount(0);
    await expect(page.getByRole('button', { name: START })).toHaveCount(0);
    expect(await fakeMidi(page).requests()).toBe(0);
    await expectOneRed(page, 'the library without Web MIDI');
    await expectNoSeriousA11y(page, 'the library without Web MIDI');
  });
});

// The rest follows the piano in the score, at a desktop's width; the home line above runs on a
// phone too.
test.describe('the score with a piano', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'the score flows run at desktop width');
  });

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

  const play = (page: Page): Locator => page.getByRole('button', { name: 'Play' });
  const rewind = (page: Page): Locator => page.getByRole('button', { name: 'Rewind' });

  /** The written second of the group the red marks (the test hook). */
  function cursorSec(page: Page): Promise<number> {
    return page.evaluate(() =>
      (window as unknown as { __digitus2: { cursorSec(): number } }).__digitus2.cursorSec(),
    );
  }

  /** The reader's key on the on-screen keyboard: the gray bar along its front edge. */
  const heldBar = (page: Page, midi: number): Locator =>
    page.locator(`.keyboard .key[data-midi="${midi}"] .key-held`);

  test('the first group waits, red, and moves on only when every note of it is held', async ({
    page,
  }) => {
    const midi = await twinkle(page);
    expect(await midi.waitForStep()).toEqual([48, 60]);
    expect(await cursorSec(page)).toBe(0);
    await expect(play(page)).not.toHaveClass(/is-red/);
    await expect(rewind(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('status')).toHaveText(HINT_MANY);
    // The existing cue: the notes are red, their keys are pressed with their fingers.
    const roots = await expectOneRed(page, 'the first group waits');
    expect(roots.every((r) => r.inSheet)).toBe(true);
    await expect(page.locator('.keyboard .key.is-pressed')).toHaveCount(2);
    await expect(page.locator('.keyboard .key.is-pressed text').first()).toHaveText(/^[1-5]$/);
    await expectNoSeriousA11y(page, 'the first group waits');

    // Rewind has nowhere to go, and neither have Home and a click on bar 1: the red does not fly
    // home and come back, and Play is never red meanwhile. A watcher in the page sees even a
    // flight that lasts a few frames, which a poll between two round trips could miss.
    await page.evaluate(() => {
      const w = window as unknown as { __sawHome?: boolean };
      w.__sawHome = false;
      const look = () => {
        if (document.querySelector('.red-ghost, button.is-red')) w.__sawHome = true;
      };
      new MutationObserver(look).observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class'],
      });
      look();
    });
    await page.keyboard.press('Home');
    await seekBar(page, 0);
    const until = Date.now() + 600;
    while (Date.now() < until)
      await expectOneRed(page, 'Home and bar 1 while the first group waits');
    expect(
      await page.evaluate(() => (window as unknown as { __sawHome?: boolean }).__sawHome),
      'the red flew home, or Play took it',
    ).toBe(false);
    expect(await cursorSec(page)).toBe(0);
    expect(await midi.index()).toBe(0);

    // One of the two notes does not move it, however long it is held; both held for the step's
    // time do (the walk hears a note as it arrives, and passes the step when its time is up).
    await midi.noteOn(60);
    expect(await midi.index()).toBe(0);
    expect(await cursorSec(page)).toBe(0);
    await staysAt(page, midi, 0);
    await midi.noteOn(48);
    await expect.poll(() => midi.index()).toBe(1);
    await expect.poll(() => midi.target()).toEqual([60]);
    await expect(page.getByRole('status')).toHaveText('');
    await expect(rewind(page)).not.toHaveAttribute('aria-disabled', 'true');
    await expect.poll(() => cursorSec(page)).toBeGreaterThan(0);
    await expectOneRed(page, 'the second group');

    // The repeated C: the key still down was used by the step before. It needs a release and a
    // fresh press, and then its time.
    await staysAt(page, midi, 1);
    await midi.noteOff(60);
    await staysAt(page, midi, 1);
    await midi.noteOn(60);
    await expect.poll(() => midi.index()).toBe(2);
    await expect.poll(() => midi.target()).toEqual([67]);
    await midi.noteOff(60);
    await midi.noteOff(48);
    expect(await strikes(page)).toEqual([]);
    await expectOneRed(page, 'the third group');
  });

  test('a wrong note moves nothing, shows on its key in gray and sounds nothing', async ({
    page,
  }) => {
    const midi = await twinkle(page);
    await midi.waitForStep();
    await midi.noteOn(61); // C sharp 4: a black key, not in the step
    await expect(heldBar(page, 61)).toHaveCount(1);
    expect(await midi.index()).toBe(0);
    expect(await cursorSec(page)).toBe(0);
    // Gray, never red: the one red element is still the cue.
    await expect(heldBar(page, 61)).toHaveCSS('fill', 'rgb(102, 102, 102)');
    const roots = await expectOneRed(page, 'a wrong note');
    expect(roots.every((r) => r.inSheet)).toBe(true);
    await expect(page.locator('.keyboard .is-red')).toHaveCount(0);
    expect(await strikes(page)).toEqual([]);
    // A held key of the step shows beside the cue's own look, and does not take its finger away.
    await midi.noteOn(60);
    await expect(heldBar(page, 60)).toHaveCount(1);
    await expect(page.locator('.keyboard .key[data-midi="60"]')).toHaveClass(/is-pressed/);
    // The key's first text is its finger: a key that fills draws the number again after it.
    await expect(page.locator('.keyboard .key[data-midi="60"] text').first()).toHaveText(/^[1-5]$/);
    expect(await midi.index()).toBe(0);
    await midi.noteOff(61);
    await midi.noteOff(60);
    await expect(page.locator('.keyboard .key-held')).toHaveCount(0);
    expect(await strikes(page)).toEqual([]);
  });

  test('keys clicked on the on-screen keyboard sound as before and never move the red', async ({
    page,
  }) => {
    const midi = await twinkle(page);
    await midi.waitForStep();
    // The keys of the first step [48 60], pressed with the mouse: they sound, and that is all.
    await page.locator('.keyboard .key[data-midi="48"] rect').first().click();
    await page.locator('.keyboard .key[data-midi="60"] rect').first().click();
    await expect.poll(() => strikes(page)).toEqual([48, 60]);
    expect(await midi.index()).toBe(0);
    expect(await cursorSec(page)).toBe(0);
    await expect(page.locator('.keyboard .key-held')).toHaveCount(0);
    await expectOneRed(page, 'keys clicked while the red waits');
  });

  test('raw bytes drive the walk: running status, active sensing, velocity 0 and any channel', async ({
    page,
  }) => {
    const midi = await twinkle(page);
    await midi.waitForStep();
    // Both notes of the first step under one status byte, with active sensing between them.
    await midi.send([0x90, 48, 90, 0xfe, 60, 90]);
    await expect.poll(() => midi.index()).toBe(1);
    // Velocity 0 is a note off, also under running status.
    await midi.send([0x90, 48, 0, 0xfe, 60, 0]);
    await expect(heldBar(page, 60)).toHaveCount(0);
    expect(await midi.index()).toBe(1);
    // Another channel, the same piano.
    await midi.noteOn(60, { channel: 9 });
    await expect.poll(() => midi.index()).toBe(2);
    await midi.noteOff(60, { channel: 9 });
    // The pedal and other controllers change nothing.
    await midi.send([0xb0, 64, 127, 0xb0, 64, 0]);
    expect(await midi.index()).toBe(2);
    expect(await strikes(page)).toEqual([]);
  });

  test('with the right hand alone, the left hand never moves the red', async ({ page }) => {
    const midi = await twinkle(page);
    await openPractice(page);
    await page.getByRole('radio', { name: 'Right hand' }).check();
    await closePractice(page);
    await expect.poll(() => midi.target()).toEqual([60]);
    await midi.noteOn(48); // the left hand's note of the step before
    await expect(page.locator('.keyboard .key-held[data-for-midi="48"]')).toHaveCount(1);
    // It is the hand left out: no step asks for it and its key does not fill.
    await expect(page.locator('.keyboard .key[data-midi="48"] rect.key-level')).toHaveCount(0);
    await staysAt(page, midi, 0);
    await midi.noteOff(48);
    await midi.noteOn(60);
    await expect.poll(() => midi.index()).toBe(1);
    await expectOneRed(page, 'the right hand alone');
  });

  test('a click on a bar hops the red there; its first group waits and the walk goes on from it', async ({
    page,
  }) => {
    const midi = await twinkle(page);
    await midi.waitForStep();
    await seekBar(page, 2);
    await expectOneRed(page, 'hopping to bar 3');
    await redSettled(page);
    expect(await midi.waitForStep()).toEqual([53, 65]);
    expect(await redBars(page)).toEqual([2]);
    await expectOneRed(page, 'bar 3 waits');
    await expect(play(page)).not.toHaveClass(/is-red/);
    // Held keys are used up by the move: a key held through the hop is not a press for the step.
    await midi.playRed();
    await expect.poll(() => redBars(page)).toEqual([2]);
    await expect.poll(() => midi.target()).toEqual([65]);
    await expectOneRed(page, 'within bar 3');
    expect(await strikes(page)).toEqual([]);
  });

  test('a key held through a seek does not count for the step the seek lands on', async ({
    page,
  }) => {
    const midi = await twinkle(page);
    await midi.waitForStep();
    await midi.noteOn(65);
    await seekBar(page, 2);
    await redSettled(page);
    expect(await midi.waitForStep()).toEqual([53, 65]);
    await midi.noteOn(53);
    await staysAt(page, midi, 7, '65 was held before the move');
    await midi.noteOff(65);
    await midi.noteOn(65);
    await expect.poll(() => midi.index()).toBe(8);
  });

  test('a loop keeps the red inside it: after the last group of the loop, its first', async ({
    page,
  }) => {
    const midi = await twinkle(page, { tempo: FAST });
    await setLoopBars(page, '2', '3');
    await closePractice(page);
    // Bars 2 and 3 hold the steps 4 to 10.
    await expect.poll(() => midi.index()).toBe(4);
    await midi.waitForStep();
    expect(await redBars(page)).toEqual([1]);
    for (let guard = 0; (await midi.index()) !== 10 && guard < 20; guard++) await midi.playRed();
    expect(await midi.index()).toBe(10);
    await midi.waitForStep();
    expect(await redBars(page)).toEqual([2]);
    await midi.playRed(); // the loop's last group
    expect(await midi.waitForStep()).toEqual([53, 69]);
    expect(await midi.index()).toBe(4);
    await expect.poll(() => redBars(page)).toEqual([1]);
    // A loop never ends: no finish.
    await expect(page.locator('.end-burst .note-burst')).toHaveCount(0);
    await expect(play(page)).not.toHaveClass(/is-red/);
    await expectOneRed(page, 'the loop wrapped');
  });

  test("Play starts at the red group, the reader's keys show while it plays, and Pause leaves the red there", async ({
    page,
  }) => {
    const midi = await twinkle(page);
    await openPractice(page);
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    await closePractice(page);
    for (let i = 0; i < 3; i++) await midi.playRed();
    expect(await midi.waitForStep()).toEqual([67]); // the second G
    const cue = await cursorSec(page);
    expect(cue).toBeGreaterThan(0);
    expect(await positionSec(page)).toBeCloseTo(cue, 6);

    await midi.noteOn(64); // a key of the reader's, held through Play (not in the step)
    await expect(heldBar(page, 64)).toHaveCount(1);
    await play(page).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    // The playing cursor starts at that group, not at the top.
    const start = await positionSec(page);
    expect(start).toBeGreaterThanOrEqual(cue - 1e-6);
    expect(start).toBeLessThan(cue + 1.2);
    await expect(heldBar(page, 64)).toHaveCount(1); // still shown while it plays
    await midi.noteOn(65); // and a new one
    await expect(heldBar(page, 65)).toHaveCount(1);
    await expectOneRed(page, 'playing from the red');
    expect(await midi.index(), 'the walk is quiet while it plays').toBe(-1);
    expect(await midi.target()).toEqual([]);
    await midi.noteOff(65);
    await midi.noteOff(64);

    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(play(page)).toBeVisible();
    const paused = await expectOneRed(page, 'paused');
    expect(paused.every((r) => r.inSheet)).toBe(true);
    await expect(play(page)).not.toHaveClass(/is-red/);
    // The group the cursor marks is the step again, and the reader's playing moves it on.
    const step = await midi.waitForStep();
    expect(step.length).toBeGreaterThan(0);
    const was = await midi.index();
    await midi.playRed();
    expect(await midi.index()).not.toBe(was);
    await expectOneRed(page, 'moved on after the pause');
    expect(await strikes(page)).toEqual([]);
  });

  test('an unplugged piano leaves the red and the cue where they are; plugged in, the walk goes on', async ({
    page,
  }) => {
    const midi = await twinkle(page);
    await midi.playRed();
    await midi.playRed();
    expect(await midi.waitForStep()).toEqual([67]);
    const cue = await cursorSec(page);

    await midi.unplug();
    await expect.poll(() => midi.target()).toEqual([]);
    expect(await cursorSec(page)).toBe(cue);
    await expect(play(page)).not.toHaveClass(/is-red/);
    await expect(page.locator('.score-sheet .is-red').first()).toBeVisible();
    await expectOneRed(page, 'unplugged while waiting');

    await midi.plug(PIANO);
    expect(await midi.waitForStep()).toEqual([67]);
    expect(await cursorSec(page)).toBe(cue);
    await midi.playRed();
    await expect.poll(() => midi.target()).toEqual([67]); // the second G of the pair
    expect(await midi.index()).toBe(3);
    await expectOneRed(page, 'plugged in again');
  });

  test('at the end the burst rises, the red flies home, and the first group waits again', async ({
    page,
  }) => {
    const midi = await twinkle(page, { tempo: FAST });
    const last = (await page.locator('.score-sheet g.measure').count()) - 1;
    await seekBar(page, last);
    await redSettled(page);
    await midi.waitForStep();
    // Exactly one red on every sample through the finish, as the burst's own spec samples it.
    const stopSampling = sampleRed(page, 'through the finish');
    try {
      await playToTheEnd(midi);
      const burst = page.locator('.end-burst .note-burst-note');
      await expect(burst.first()).toBeAttached();
      expect(await burst.count()).toBeGreaterThanOrEqual(6);
      await expect(page.locator('.end-burst .is-red')).toHaveCount(0);
      // The red is back on the first group, and Rewind has nowhere to go.
      await expect.poll(() => midi.index(), { timeout: 15_000 }).toBe(0);
      await midi.waitForStep();
      await expect(rewind(page)).toHaveAttribute('aria-disabled', 'true');
      expect(await redBars(page)).toEqual([0]);
      expect(await cursorSec(page)).toBe(0);
      await expect(play(page)).not.toHaveClass(/is-red/);
      await expect(page.locator('.score-sheet .is-red').first()).toBeInViewport();
    } finally {
      await stopSampling();
    }
    expect(await midi.target()).toEqual([48, 60]);
    expect(await strikes(page)).toEqual([]);
    await expectOneRed(page, 'the first group waits again');
  });

  test('under reduced motion the piece ends with no burst and the first group waits again', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const midi = await twinkle(page, { tempo: FAST });
    const last = (await page.locator('.score-sheet g.measure').count()) - 1;
    await seekBar(page, last);
    await redSettled(page);
    await midi.waitForStep();
    // No flight: Play is red for a frame, then the first group.
    const stopSampling = sampleRed(page, 'through the finish, reduced motion');
    try {
      await playToTheEnd(midi);
      await expect.poll(() => midi.index(), { timeout: 15_000 }).toBe(0);
      await midi.waitForStep();
    } finally {
      await stopSampling();
    }
    await expect(page.locator('.end-burst .note-burst')).toHaveCount(0);
    await expect(rewind(page)).toHaveAttribute('aria-disabled', 'true');
    expect(await redBars(page)).toEqual([0]);
    expect(await cursorSec(page)).toBe(0);
    await expectOneRed(page, 'ended under reduced motion');
  });

  test('a repeat is walked as heard: the red goes back to the repeated bar and on to the next section', async ({
    page,
  }) => {
    // Bars 1 to 4 of BWV 994 are repeated (issue 50).
    await installFakeMidi(page, {
      permission: 'granted',
      playAlong: true,
      tempo: { [BWV994]: 1.5 },
    });
    await page.goto('/?audio=silent#/piece/bach-applicatio-c-major-bwv-994');
    await expect(page.locator('.score-sheet g.measure')).toHaveCount(8, { timeout: 20_000 });
    await expect(play(page)).toBeEnabled();
    await embellishDecided(page);
    const midi = fakeMidi(page);
    await openPractice(page);
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    await closePractice(page);
    await seekBar(page, 3);
    await redSettled(page);
    await midi.waitForStep();
    expect(await redBars(page)).toEqual([3]);

    // The last bar of the first pass: after its last group the red is on bar 1 again, not on
    // the following bar and not still in bar 4.
    const first: number[] = [];
    for (let guard = 0; guard < 120; guard++) {
      await midi.waitForStep();
      const [bar] = await redBars(page);
      first.push(bar!);
      if (bar === 0) break;
      await midi.playRed();
    }
    expect(first.at(-1), `bars walked: ${first.join(',')}`).toBe(0);
    expect(new Set(first)).toEqual(new Set([3, 0]));
    await expectOneRed(page, 'back on bar 1');

    // Play from there is the second hearing: it goes on to bar 5, it does not loop the first.
    await play(page).click();
    await expect.poll(() => redBars(page), { timeout: 6_000 }).toEqual([0]);
    for (const bar of [1, 2, 3]) {
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => redBars(page), { timeout: 4_000 }).toEqual([bar]);
    }
    await expect.poll(() => redBars(page), { timeout: 6_000 }).toEqual([4]);
    await expectOneRed(page, 'the second hearing carried on');
  });

  test('the walk through the second hearing goes on to the next section and never back', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await installFakeMidi(page, {
      permission: 'granted',
      playAlong: true,
      tempo: { [BWV994]: 1.5 },
    });
    await page.goto('/?audio=silent#/piece/bach-applicatio-c-major-bwv-994');
    await expect(page.locator('.score-sheet g.measure')).toHaveCount(8, { timeout: 20_000 });
    await expect(play(page)).toBeEnabled();
    await embellishDecided(page);
    const midi = fakeMidi(page);
    await seekBar(page, 3);
    await redSettled(page);
    const bars: number[] = [];
    for (let guard = 0; guard < 400; guard++) {
      await midi.waitForStep();
      const [bar] = await redBars(page);
      bars.push(bar!);
      if (bar === 4) break;
      await midi.playRed();
    }
    // Bar 4, bars 1 to 4 again, then bar 5: bar 1 is visited once after the first return.
    const trail = bars.filter((b, i) => i === 0 || b !== bars[i - 1]);
    expect(trail, `bars walked: ${bars.join(',')}`).toEqual([3, 0, 1, 2, 3, 4]);
  });

  for (const [width, height] of [
    [1280, 600],
    [360, 740],
  ] as const) {
    test.describe(`the page turns at ${width} px`, () => {
      test.use({ viewport: { width, height } });

      test('the page scrolls once as the red enters the next system, and not within a system', async ({
        page,
      }) => {
        test.setTimeout(120_000);
        const midi = await twinkle(page, { tempo: FAST });
        // The seeded 150 % took: the first step's 600 ms are 400 ms.
        await midi.waitForStep();
        expect(await midi.hold(), 'the Practice tempo was not seeded').toBeCloseTo(400, 0);
        const steps: Array<{ i: number; system: number; y: number }> = [];
        for (let guard = 0; guard < 60; guard++) {
          await midi.waitForStep();
          const y = await scrollSettled(page);
          const { system, above, below } = await page.evaluate(() => {
            const systems = [...document.querySelectorAll('.score-sheet g.system')];
            const marked = [...document.querySelectorAll('.score-sheet .is-red')];
            // The band the cursor keeps the red in: the window less the page's scroll padding
            // (the dock at the bottom). How far the red lies outside it, in px (0 inside).
            const style = getComputedStyle(document.documentElement);
            const top = parseFloat(style.scrollPaddingTop) || 0;
            const bottom = window.innerHeight - (parseFloat(style.scrollPaddingBottom) || 0);
            const rects = marked.map((el) => el.getBoundingClientRect());
            return {
              system: marked[0] ? systems.indexOf(marked[0].closest('g.system')!) : -1,
              above: Math.max(0, ...rects.map((r) => top - r.top)),
              below: Math.max(0, ...rects.map((r) => r.bottom - bottom)),
            };
          });
          // The red is on screen, clear of the dock, at every step (1 px of slack).
          expect(above, `the red is above the band at step ${guard}`).toBeLessThanOrEqual(1);
          expect(below, `the red is below the band at step ${guard}`).toBeLessThanOrEqual(1);
          steps.push({ i: await midi.index(), system, y });
          const played = await midi.playRed();
          const now = await midi.index();
          if (now === -1 || now < played) break; // the piece is finished
        }
        const trail = JSON.stringify(steps.map((s) => [s.i, s.system, s.y]));
        test
          .info()
          .annotations.push({ type: `[step, system, scrollY] at ${width} px`, description: trail });
        expect(steps.length, trail).toBeGreaterThan(10);
        const systems = new Set(steps.map((s) => s.system));
        expect(systems.size, trail).toBeGreaterThan(1);
        for (let k = 1; k < steps.length; k++) {
          const [a, b] = [steps[k - 1]!, steps[k]!];
          if (a.system === b.system) expect(b.y, `within system ${a.system}: ${trail}`).toBe(a.y);
          // Reading down the piece, the page only goes down.
          expect(b.y, `going back at step ${b.i}: ${trail}`).toBeGreaterThanOrEqual(a.y);
        }
        const turns = steps.filter((s, k) => k > 0 && s.y !== steps[k - 1]!.y).length;
        // The page does turn (the red enters systems below the window), once per turn at most.
        expect(turns, trail).toBeGreaterThanOrEqual(1);
        expect(turns, trail).toBeLessThanOrEqual(systems.size - 1);
        await expectOneRed(page, 'after the page turns');
      });
    });
  }

  // ---------------------------------------------------------------------------------------
  // The other hand (issue 184). With one hand left out, digitus plays it between the reader's
  // steps, counted from the press that starts each step running. The fixture is Twinkle at 100 qpm, a quarter note 0.6 s, a
  // bar 2.4 s. Right hand chosen (the reader plays the right, digitus the left): every left-hand
  // note falls on a step of the right hand, so each stretch holds at most one note, at the
  // press. Left hand chosen (the reader plays the left, digitus the right): the steps are
  // [48]@0, [53]@2.4, [48]@3.6, [53]@4.8, [48]@6.0 ... and the right hand between them gives
  // stretches with several notes. Stretch of step 0, [0, 2.4): 60@0, 60@0.6, 67@1.2, 67@1.8.
  // Stretch of step 1, [2.4, 3.6): 69@2.4, 69@3.0. Of step 3, [4.8, 6.0): 65@4.8, 65@5.4. The
  // times are on the audio clock: press + offset / tempo, so differences are exact (asserted to
  // the millisecond). `accompCancelled()` holds the notes dropped from the queue before they
  // were handed over, then those cancelled or released after.
  // ---------------------------------------------------------------------------------------

  /** The reader plays the left hand, and the Practice tempo is 50 % (stored, never clicked). */
  const HALF = { hands: 'L', tempoByPiece: { [`piece:${TWINKLE}`]: 0.5 } };

  /** The status line in the dock (a notice elsewhere is a status too). */
  const dockStatus = (page: Page): Locator => page.locator('.dock').getByRole('status');

  /** The audio is running and the samples are in: digitus can sound. */
  async function soundReady(page: Page): Promise<void> {
    await expect.poll(() => audioState(page)).toBe('running');
    await expect(dockStatus(page)).not.toHaveText(LOADING_THE_PIANO);
  }

  /** The time of each note after the first, in milliseconds. */
  const gaps = (notes: readonly { time: number }[]): number[] =>
    notes.map((n) => Math.round((n.time - notes[0]!.time) * 1000));
  const ms = (sec: number): number => Math.round(sec * 1000);

  test('with the right hand chosen, digitus plays the left: after the reader presses, never before', async ({
    page,
  }) => {
    const midi = await twinkle(page, { settings: { hands: 'R' } });
    await soundReady(page);
    expect(await midi.waitForStep()).toEqual([60]);
    // Nothing before the first press: the left hand's opening is the reader's lead.
    for (let i = 0; i < 4; i++) {
      expect(await accompanied(page)).toEqual([]);
      await page.waitForTimeout(125);
    }
    await expectOneRed(page, 'right hand, before the first press');

    await midi.playRed();
    await expect.poll(() => accompanied(page)).toHaveLength(1);
    expect((await accompanied(page))[0]).toMatchObject({ midi: 48, hand: 'L' });
    // Steps 1 to 9: the left hand sounds at steps 4, 6, 7 and 9 only (its notes at 2.4, 3.6,
    // 4.8 and 6.0 s), each as it is written, and never a note of the right hand.
    for (let i = 1; i < 10; i++) await midi.playRed();
    const played = await accompanied(page);
    expect(played.map((n) => [n.midi, n.hand])).toEqual([
      [48, 'L'],
      [53, 'L'],
      [48, 'L'],
      [53, 'L'],
      [48, 'L'],
    ]);
    expect(played.map((n) => ms(n.duration))).toEqual([2400, 1200, 1200, 1200, 1200]);
    expect(played.every((n) => n.velocity > 0)).toBe(true);
    expect(played.map((n) => n.time)).toEqual([...played.map((n) => n.time)].sort((a, b) => a - b));
    expect(await strikes(page)).toEqual([]);
    await expectOneRed(page, 'right hand, after ten steps');
  });

  test('with the left hand chosen, digitus plays the right hand as it is written, from the press', async ({
    page,
  }) => {
    const midi = await twinkle(page, { settings: { hands: 'L' } });
    await soundReady(page);
    expect(await midi.waitForStep()).toEqual([48]);
    expect(await accompanied(page)).toEqual([]);
    await midi.playRed(); // step 0: the right hand until the reader's next step, 2.4 s away
    await expect.poll(() => accompanied(page)).toHaveLength(4);
    const first = await accompanied(page);
    expect(first.map((n) => [n.midi, n.hand])).toEqual([
      [60, 'R'],
      [60, 'R'],
      [67, 'R'],
      [67, 'R'],
    ]);
    expect(gaps(first)).toEqual([0, 600, 1200, 1800]);
    expect(first.map((n) => ms(n.duration))).toEqual([600, 600, 600, 600]);
    // The next step, played at its time: its stretch counts from that press.
    await midi.playRed();
    await expect.poll(() => accompanied(page)).toHaveLength(6);
    const second = (await accompanied(page)).slice(4);
    expect(second.map((n) => n.midi)).toEqual([69, 69]);
    expect(gaps(second)).toEqual([0, 600]);
    expect(await strikes(page)).toEqual([]);
    await expectOneRed(page, 'left hand, two steps');
  });

  test('with both hands chosen digitus plays nothing, and loads nothing', async ({ page }) => {
    const midi = await twinkle(page);
    await midi.waitForStep();
    for (let i = 0; i < 6; i++) await midi.playRed();
    expect(await accompanied(page)).toEqual([]);
    expect(await accompCancelled(page)).toEqual([]);
    // No hand to play: no audio was made for it, and the status line never asked for the piano.
    expect(await audioState(page)).toBe('none');
    await expect(dockStatus(page)).not.toHaveText(LOADING_THE_PIANO);
    expect(await strikes(page)).toEqual([]);
    await expectOneRed(page, 'both hands');
  });

  test('the Practice tempo sets the pace: at 50 % the same stretch takes twice as long', async ({
    page,
  }) => {
    const midi = await twinkle(page, { settings: { hands: 'L' } });
    await soundReady(page);
    await openPractice(page);
    await page.getByRole('slider', { name: 'Tempo' }).fill('50');
    await expect(page.locator('.tempo-value')).toHaveText('50 % · ♩ = 50');
    await closePractice(page);
    await midi.playRed();
    await expect.poll(() => accompanied(page)).toHaveLength(4);
    const notes = await accompanied(page);
    expect(notes.map((n) => n.midi)).toEqual([60, 60, 67, 67]);
    expect(gaps(notes)).toEqual([0, 1200, 2400, 3600]);
    expect(notes.map((n) => ms(n.duration))).toEqual([1200, 1200, 1200, 1200]);
    await expectOneRed(page, 'at 50 %');
  });

  test('a step pressed again drops the notes that have not started and counts from the new press', async ({
    page,
  }) => {
    const midi = await twinkle(page, { settings: HALF });
    await soundReady(page);
    // The step runs the moment its key is down (issue 185): 60 sounds now; 60, 67, 67 wait 1.2,
    // 2.4 and 3.6 s. The pass comes a note's length later (4.8 s at 50 %) and hands over nothing.
    await midi.pressStep();
    await expect.poll(() => accompanied(page)).toHaveLength(1);
    const pitches = await midi.target();
    // A release that comes too early leaves the red where it is and the other hand playing.
    for (const pitch of pitches) await midi.noteOff(pitch);
    expect(await accompCancelled(page)).toEqual([]);
    // The same step pressed again runs from this press: its stretch starts again.
    for (const pitch of pitches) await midi.noteOn(pitch);
    await expect.poll(() => accompanied(page)).toHaveLength(2);
    const [first, second] = await accompanied(page);
    expect(first).toMatchObject({ midi: 60, hand: 'R' });
    expect(second).toMatchObject({ midi: 60, hand: 'R' });
    // The queue's three notes were dropped; the note that had started is not among them.
    const dropped = await accompCancelled(page);
    expect(dropped.map((n) => n.midi)).toEqual([60, 67, 67]);
    expect(dropped.map((n) => ms(n.time - first!.time))).toEqual([1200, 2400, 3600]);
    // The second stretch counts from the second press: 60 again 0.6 s on, at 50 %.
    await expect.poll(() => accompanied(page)).toHaveLength(3);
    const all = await accompanied(page);
    expect(all[2]).toMatchObject({ midi: 60 });
    expect(ms(all[2]!.time - second!.time)).toBe(1200);
    await expectOneRed(page, 'after the second press');
  });

  test('a click on a bar drops them, and nothing sounds until the next press', async ({ page }) => {
    const midi = await twinkle(page, { settings: HALF });
    await soundReady(page);
    // The step runs at the press, and its stretch with it; the key stays down, so the pass (a
    // note's length on, 4.8 s at 50 %) has not come when the reader clicks the bar.
    const held = await midi.waitForStep();
    await midi.pressStep({ wait: false });
    await expect.poll(() => accompanied(page)).toHaveLength(1);
    const [first] = await accompanied(page);
    await seekBar(page, 2);
    await redSettled(page);
    expect(await midi.waitForStep()).toEqual([53]); // bar 3 starts at 4.8 s
    for (const pitch of held) await midi.noteOff(pitch);
    // The three notes still waiting were dropped, and the one that sounds was released.
    const cancelled = await accompCancelled(page);
    expect(cancelled.map((n) => n.midi)).toEqual([60, 67, 67, 60]);
    expect(cancelled.slice(0, 3).map((n) => ms(n.time - first!.time))).toEqual([1200, 2400, 3600]);
    expect(cancelled[3]!.time).toBe(first!.time);
    expect(await accompanied(page)).toHaveLength(1);
    await expectOneRed(page, 'after the seek');
    // The step of bar 3 pressed: its stretch, [4.8, 6.0), from this press.
    await midi.pressStep();
    await expect.poll(() => accompanied(page)).toHaveLength(2);
    expect((await accompanied(page))[1]).toMatchObject({ midi: 65, hand: 'R' });
  });

  // That Play stops it in the click itself, before the transport schedules anything, is the
  // ordering usePlayback.accompany.test.ts guards ('is done by play() in the click'); here the
  // walk's own stop would also catch it one render later, so this checks the outcome.
  test('Play stops it, plays by itself, and Pause gives the walk back', async ({ page }) => {
    const midi = await twinkle(page, { settings: HALF });
    await openPractice(page);
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    await closePractice(page);
    await soundReady(page);
    const held = await midi.waitForStep();
    await midi.pressStep({ wait: false }); // the step runs at the press: the stretch is handed over
    await expect.poll(() => accompanied(page)).toHaveLength(1);
    await play(page).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    const cancelled = await accompCancelled(page);
    expect(cancelled.map((n) => n.midi)).toEqual([60, 67, 67, 60]);
    // The cursor runs as it always did, and nothing of the accompaniment is scheduled.
    const start = await positionSec(page);
    await expect.poll(() => positionSec(page)).toBeGreaterThan(start + 0.3);
    expect(await accompanied(page)).toHaveLength(1);
    expect(await midi.index(), 'the walk is quiet while it plays').toBe(-1);
    await expectOneRed(page, 'playing, after the accompaniment');

    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(play(page)).toBeVisible();
    for (const pitch of held) await midi.noteOff(pitch);
    await midi.waitForStep();
    await midi.pressStep();
    await expect.poll(() => accompanied(page)).toHaveLength(2);
    await expectOneRed(page, 'paused, and the walk went on');
  });

  test('the last step plays the tail while the burst rises, and the red coming home does not cut it', async ({
    page,
  }) => {
    const midi = await twinkle(page, { settings: HALF });
    await soundReady(page);
    const last = (await page.locator('.score-sheet g.measure').count()) - 1;
    await seekBar(page, last);
    await redSettled(page);
    await midi.waitForStep();
    const stopSampling = sampleRed(page, 'through the finish and the tail');
    let tail: AccompaniedNote | undefined;
    try {
      await playToTheEnd(midi);
      tail = (await accompanied(page)).at(-1);
      const burst = page.locator('.end-burst .note-burst-note');
      await expect(burst.first()).toBeAttached();
      await expect.poll(() => midi.index(), { timeout: 15_000 }).toBe(0);
      await midi.waitForStep();
    } finally {
      await stopSampling();
    }
    // The last bar's last step is the left hand's 48 at 27.6 s; the tail until 28.8 s is the
    // right hand's 60, a minim at 50 %: it rings for 2.4 s, from the press.
    expect(tail).toMatchObject({ midi: 60, hand: 'R' });
    expect(ms(tail!.duration)).toBe(2400);
    // Neither the finish nor the re-cue of the first step cut it: it was never cancelled.
    const cancelled = await accompCancelled(page);
    expect(cancelled.some((n) => n.midi === 60 && n.time === tail!.time)).toBe(false);
    await expectOneRed(page, 'home again, the tail ringing');
  });

  test('a loop plays to the loop end and waits there; its first step starts it again', async ({
    page,
  }) => {
    const midi = await twinkle(page, { settings: { hands: 'L' } });
    await soundReady(page);
    await setLoopBars(page, '2', '3'); // [2.4, 7.2): the steps 1 to 4
    await closePractice(page);
    await expect.poll(() => midi.index()).toBe(1);
    await midi.waitForStep();
    for (let guard = 0; (await midi.index()) !== 4 && guard < 20; guard++) await midi.playRed();
    expect(await midi.index()).toBe(4);
    await midi.waitForStep();
    const sixtyFours = async () => (await accompanied(page)).filter((n) => n.midi === 64);
    expect(await sixtyFours()).toEqual([]);
    await midi.playRed(); // the loop's last step, 6.0 s: it wraps to the first
    // The right hand until the loop's end, 7.2 s: 64 at 6.0 and 64 at 6.6, a quarter each.
    await expect.poll(async () => (await sixtyFours()).length).toBe(2);
    const wrap = await sixtyFours();
    expect(gaps(wrap)).toEqual([0, 600]);
    expect(wrap.map((n) => ms(n.duration))).toEqual([600, 600]);
    expect(await midi.waitForStep()).toEqual([53]); // the loop's first step
    await expect.poll(() => redBars(page)).toEqual([1]);
    // Nothing of bar 2 sounds until its first step is played.
    expect((await accompanied(page)).at(-1)!.midi).toBe(64);
    await midi.playRed();
    await expect.poll(async () => (await accompanied(page)).at(-1)!.midi).toBe(69);
    await expectOneRed(page, 'the loop wrapped');
  });

  test('an unplugged piano stops it mid-stretch; the red and the cue stay', async ({ page }) => {
    const midi = await twinkle(page, { settings: HALF });
    await soundReady(page);
    await midi.pressStep(); // the step runs at the press: the stretch is handed over, the red stays
    await expect.poll(() => accompanied(page)).toHaveLength(1);
    const cue = await cursorSec(page);
    await midi.unplug();
    await expect.poll(() => midi.target()).toEqual([]);
    await expect.poll(() => accompCancelled(page)).toHaveLength(4);
    expect((await accompCancelled(page)).map((n) => n.midi)).toEqual([60, 67, 67, 60]);
    expect(await cursorSec(page)).toBe(cue);
    await expect(play(page)).not.toHaveClass(/is-red/);
    await expect(page.locator('.score-sheet .is-red').first()).toBeVisible();
    await expectOneRed(page, 'unplugged mid-stretch');

    await midi.plug(PIANO);
    expect(await midi.waitForStep()).toEqual([48]); // the step that was held, which never passed
    expect(await cursorSec(page)).toBe(cue);
    expect(await accompanied(page)).toHaveLength(1);
  });

  // The real instrument (`?hooks=1`) with the samples served late. Loading them for the other
  // hand is `preparing`, never `loading`: the walk is not turned off, Play is not busy.
  test('while the piano loads for the other hand the line says so and the red goes on moving', async ({
    page,
  }) => {
    const requested = await delayPianoSamples(page, 3_000);
    const midi = await twinkle(page, { settings: { hands: 'R' } }, 'hooks=1');
    const status = dockStatus(page);
    await expect(status).toHaveText(LOADING_THE_PIANO);
    await expect.poll(() => midi.target()).toEqual([60]); // the walk is active
    await expect(play(page)).not.toHaveAttribute('aria-busy');
    await expect(play(page)).not.toHaveClass(/is-red/);
    await expectOneRed(page, 'loading the piano for the other hand');
    expect(requested.length).toBeGreaterThan(0);

    await midi.playRed(); // moves the red during the load
    expect(await midi.index()).toBe(1);
    expect(await accompanied(page)).toEqual([]); // nothing to sound it with yet
    await expectOneRed(page, 'the red moved during the load');

    // Once the samples are in, the first stretch with a left-hand note sounds: step 4.
    await expect(status).not.toHaveText(LOADING_THE_PIANO, { timeout: 20_000 });
    for (let i = 0; i < 8 && (await accompanied(page)).length === 0; i++) await midi.playRed();
    expect((await accompanied(page))[0]).toMatchObject({ midi: 53, hand: 'L' });
    expect(await strikes(page)).toEqual([]);
  });

  test('a piano that cannot load tells it once, and the walk goes on without sound', async ({
    page,
  }) => {
    let requests = 0;
    await page.route(PIANO_SAMPLES, (route) => {
      requests++;
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>digitus2</title>',
      });
    });
    const midi = await twinkle(page, { settings: { hands: 'R' } }, 'hooks=1');
    const notice = page.getByText(/piano sounds could not be loaded/);
    await expect(notice).toBeVisible({ timeout: 20_000 });
    await expect(notice).toHaveCount(1);
    await expect(dockStatus(page)).not.toHaveText(LOADING_THE_PIANO);
    const asked = requests;
    expect(asked).toBeGreaterThan(0);
    for (let i = 0; i < 6; i++) await midi.playRed();
    expect(await midi.index()).toBe(6);
    expect(await accompanied(page)).toEqual([]);
    expect(requests, 'the samples are not asked for again').toBe(asked);
    await expectOneRed(page, 'no sound, the walk went on');
  });

  test('"Add notes between" keeps the red in its bar', async ({ page }) => {
    const midi = await twinkle(page);
    await seekBar(page, 2);
    await redSettled(page);
    await midi.waitForStep();
    expect(await redBars(page)).toEqual([2]);
    await openPractice(page);
    await page.getByRole('checkbox', { name: 'Add notes between' }).check();
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(70, { timeout: 20_000 });
    await closePractice(page);
    await redSettled(page);
    await midi.waitForStep();
    await expect.poll(() => redBars(page)).toEqual([2]);
    await expectOneRed(page, 'the carried bar');
    await midi.playRed();
    await expect.poll(() => redBars(page)).toEqual([2]);
    await openPractice(page);
    await page.getByRole('checkbox', { name: 'Add notes between' }).uncheck();
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(TWINKLE_NOTES, {
      timeout: 20_000,
    });
    await closePractice(page);
    await redSettled(page);
    await midi.waitForStep();
    await expect.poll(() => redBars(page)).toEqual([2]);
    await expectOneRed(page, 'the bar kept after switching off');
  });

  // A step passes once its keys have been held for its time, and the held keys fill over their
  // notes' lengths (issue 185). Twinkle's first step is [48 60] at 100 qpm: a quarter is 600 ms,
  // the hold of the step, and the left hand's C is a whole note of 4 beats.

  /** A key's level, the fill that rises inside it while the reader holds it. */
  const level = (page: Page, midi: number): Locator =>
    page.locator(`.keyboard .key[data-midi="${midi}"] rect.key-level`);
  /** The finger number or hand letter drawn again over the level, in the light gray. */
  const levelText = (page: Page, midi: number): Locator =>
    page.locator(`.keyboard .key[data-midi="${midi}"] text.key-on-level`);

  test('a short hold does not pass and asks for a longer one; a held note passes at its time', async ({
    page,
  }) => {
    const midi = await twinkle(page);
    await midi.waitForStep();
    const hold = await midi.hold();
    expect(hold, 'the first step is held for a quarter at 100 qpm').toBe(600);

    // Both keys down for a third of the hold, then up (all in the page, so a slow round trip
    // cannot make the short hold long): the red stays and the status line asks for more.
    const tapped = await midi.tap([48, 60], Math.round(hold / 3));
    expect(tapped, 'the page ran the short tap long: it is the PC, not the walk').toBeLessThan(
      0.8 * hold,
    );
    await expect(page.getByRole('status')).toHaveText(HOLD_MANY);
    expect(await midi.index()).toBe(0);
    expect(await cursorSec(page)).toBe(0);
    expect(await midi.target()).toEqual([48, 60]);
    await expectOneRed(page, 'a short hold');
    await expectNoSeriousA11y(page, 'a short hold');

    // Held again, it passes at its time: no sooner than the hold, and not much later.
    const { index, ms } = await midi.playRedTimed();
    expect(index).toBe(0);
    expect(ms, 'the step passed before its time').toBeGreaterThanOrEqual(hold - 20);
    expect(ms, 'the step passed long after its time').toBeLessThan(hold + 400);
    await expect(page.getByRole('status')).toHaveText('');
    expect(await midi.index()).toBe(1);
    await expectOneRed(page, 'the held note passed');
    expect(await strikes(page)).toEqual([]);
  });

  test("a key fills over its note's length, is full, and drains when let go early", async ({
    page,
  }) => {
    const midi = await twinkle(page);
    await midi.waitForStep();
    await midi.noteOn(50); // a wrong note: its bar, never a level
    await expect(heldBar(page, 50)).toHaveCount(1);

    // Both keys of the first step go down and the page watches, frame by frame, until the red
    // moves on: the left hand's whole note fills slowly, the right hand's quarter is full by then.
    const watched = await page.evaluate(async () => {
      const w = window as unknown as {
        __digitus2Along: { index(): number };
        __fakeMidi: { send(bytes: number[]): void };
      };
      const heightOf = (m: number): number | null => {
        const el = document.querySelector(`.keyboard .key[data-midi="${m}"] rect.key-level`);
        return el ? Number(el.getAttribute('height')) : null;
      };
      const was = w.__digitus2Along.index();
      const rising: Record<number, number[]> = { 48: [], 60: [] };
      const numbers: Record<number, string | null> = { 48: null, 60: null };
      let wrongNoteFilled = false;
      for (const m of [48, 60]) w.__fakeMidi.send([0x90, m, 100]);
      const started = performance.now();
      await new Promise<void>((resolve) => {
        const look = () => {
          for (const m of [48, 60]) {
            const h = heightOf(m);
            if (h !== null) rising[m]!.push(h);
            const text = document.querySelector(
              `.keyboard .key[data-midi="${m}"] text.key-on-level`,
            );
            if (text) numbers[m] = text.textContent;
          }
          if (document.querySelector('.keyboard .key[data-midi="50"] rect.key-level'))
            wrongNoteFilled = true;
          if (w.__digitus2Along.index() !== was || performance.now() - started > 10_000) resolve();
          else requestAnimationFrame(look);
        };
        look();
      });
      await new Promise((r) => requestAnimationFrame(r)); // the attributes follow the clock by a frame
      return { rising, numbers, wrongNoteFilled, now: { 48: heightOf(48), 60: heightOf(60) } };
    });
    const grew = watched.rising[48]!;
    expect(grew.length, `samples of 48's level: ${grew}`).toBeGreaterThan(1);
    for (let i = 1; i < grew.length; i++) expect(grew[i]!).toBeGreaterThanOrEqual(grew[i - 1]!);
    expect(grew.at(-1)!, `48's level did not rise: ${grew}`).toBeGreaterThan(grew[0]!);
    const grew60 = watched.rising[60]!;
    expect(grew60.length, `samples of 60's level: ${grew60}`).toBeGreaterThan(1);
    for (let i = 1; i < grew60.length; i++)
      expect(grew60[i]!).toBeGreaterThanOrEqual(grew60[i - 1]!);
    expect(grew60.at(-1)!, `60's level did not rise: ${grew60}`).toBeGreaterThan(grew60[0]!);
    expect(watched.wrongNoteFilled, 'the wrong note 50 got a level').toBe(false);
    // The red moves on (step 1 asks for 60 again): 60's note is over, so its key is full (94
    // units, the key's height less its insets); 48's whole note is a quarter of the way (5 units
    // of bar and 89 to fill: 27.25 at 0.25).
    expect(watched.now[60]).toBeCloseTo(94, 0);
    const fraction = (watched.now[48]! - 5) / 89;
    expect(fraction, `48 filled to ${watched.now[48]}`).toBeGreaterThan(0.2);
    expect(fraction, `48 filled to ${watched.now[48]}`).toBeLessThan(0.4);
    await expect.poll(() => midi.target()).toEqual([60]);

    // The finger number was drawn again over the level on both keys while their step was asked
    // for (48 is no longer shown pressed once the red has moved on, so its copy is gone with the
    // number); 60 is asked for again. The wrong note has no level.
    expect(watched.numbers[48]).toMatch(/^[1-5]$/);
    expect(watched.numbers[60]).toMatch(/^[1-5]$/);
    await expect(levelText(page, 60)).toHaveCount(1);
    await expect(levelText(page, 60)).toHaveText(/^[1-5]$/);
    await expect(level(page, 50)).toHaveCount(0);
    await expect(heldBar(page, 50)).toHaveCount(1);
    await expectOneRed(page, 'the keys filling');
    await expectNoSeriousA11y(page, 'the keys filling');

    // 48 is let go early: it drains to nothing over --dur-slow (200 ms), shrinking all the way.
    const drained = await page.evaluate(async () => {
      const w = window as unknown as { __fakeMidi: { send(bytes: number[]): void } };
      const el = () => document.querySelector('.keyboard .key[data-midi="48"] rect.key-level');
      const heights: number[] = [];
      const started = performance.now();
      w.__fakeMidi.send([0x80, 48, 0]);
      await new Promise<void>((resolve) => {
        const look = () => {
          const found = el();
          if (!found || performance.now() - started > 3_000) resolve();
          else {
            heights.push(Number(found.getAttribute('height')));
            requestAnimationFrame(look);
          }
        };
        look();
      });
      return { heights, ms: performance.now() - started };
    });
    expect(drained.heights.length, `heights while draining: ${drained.heights}`).toBeGreaterThan(1);
    for (let i = 2; i < drained.heights.length; i++)
      expect(drained.heights[i]!).toBeLessThanOrEqual(drained.heights[i - 1]! + 0.01);
    expect(drained.heights.at(-1)!).toBeLessThan(drained.heights[0]!);
    expect(drained.ms, 'the level went before its drain').toBeGreaterThanOrEqual(150);
    expect(drained.ms, 'the level stayed after its drain').toBeLessThan(1_500);
    await expect(level(page, 48)).toHaveCount(0);
    await expect(levelText(page, 48)).toHaveCount(0);

    // 60 is full: let go, its level goes with its bar at once (the next poll finds none).
    await expect(level(page, 60)).toHaveCount(1);
    const lingered = await page.evaluate(async () => {
      const w = window as unknown as { __fakeMidi: { send(bytes: number[]): void } };
      w.__fakeMidi.send([0x80, 60, 0]);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return document.querySelector('.keyboard .key[data-midi="60"] rect.key-level') !== null;
    });
    expect(lingered, 'a full level was still there two frames after the key came up').toBe(false);
    await expect(heldBar(page, 60)).toHaveCount(0);
    await midi.noteOff(50);
    await expect(page.locator('.keyboard .key-held')).toHaveCount(0);
    expect(await strikes(page)).toEqual([]);
  });

  // The level's gray and the number on it, in both themes, at a desktop's width and a phone's
  // (the keys' colors come from tokens, so the check resolves each token in the page).
  for (const [width, height] of [
    [1280, 900],
    [360, 740],
  ] as const) {
    test.describe(`the levels at ${width} px`, () => {
      test.use({ viewport: { width, height } });

      for (const scheme of ['light', 'dark'] as const) {
        test(`in the ${scheme} theme the level and its number take their tokens, one red throughout`, async ({
          page,
        }) => {
          await page.emulateMedia({ colorScheme: scheme });
          const midi = await twinkle(page);
          await midi.waitForStep();
          const hold = await midi.hold();

          // The hold hint on the status line.
          const tapped = await midi.tap([48, 60], Math.round(hold / 3));
          expect(tapped, 'the page ran the short tap long: it is the PC').toBeLessThan(0.8 * hold);
          await expect(page.getByRole('status')).toHaveText(HOLD_MANY);
          await expectOneRed(page, `${scheme}, ${width} px, the hold hint`);
          await expectNoSeriousA11y(page, `${scheme}, ${width} px, the hold hint`);

          // Both keys held: the levels rise (48's for 2.4 s, and 60's stays once full). The page
          // reads the colours as soon as both numbers are drawn over their levels, which is
          // before the step is passed at 600 ms and 48 stops being shown pressed.
          const colours = await page.evaluate(async () => {
            const w = window as unknown as { __fakeMidi: { send(bytes: number[]): void } };
            const copy = (m: number) =>
              document.querySelector(`.keyboard .key[data-midi="${m}"] text.key-on-level`);
            for (const m of [48, 60]) w.__fakeMidi.send([0x90, m, 100]);
            const started = performance.now();
            await new Promise<void>((resolve) => {
              const look = () =>
                (copy(48) && copy(60)) || performance.now() - started > 3_000
                  ? resolve()
                  : requestAnimationFrame(look);
              look();
            });
            const svg = document.querySelector('.keyboard svg')!;
            const tokenColour = (token: string): string => {
              const probe = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
              probe.style.fill = `var(${token})`;
              svg.appendChild(probe);
              const colour = getComputedStyle(probe).fill;
              probe.remove();
              return colour;
            };
            const fill = (selector: string): string =>
              getComputedStyle(document.querySelector(selector)!).fill;
            return {
              held: tokenColour('--key-held'),
              onLevel: tokenColour('--key-on-level'),
              level48: fill('.keyboard .key[data-midi="48"] rect.key-level'),
              level60: fill('.keyboard .key[data-midi="60"] rect.key-level'),
              text48: fill('.keyboard .key[data-midi="48"] text.key-on-level'),
              text60: fill('.keyboard .key[data-midi="60"] text.key-on-level'),
            };
          });
          expect(colours.level48).toBe(colours.held);
          expect(colours.level60).toBe(colours.held);
          expect(colours.text48).toBe(colours.onLevel);
          expect(colours.text60).toBe(colours.onLevel);
          // The tokens themselves: a gray bar and the lightest text on it, never the accent.
          expect(colours.held).toBe(scheme === 'light' ? 'rgb(102, 102, 102)' : 'rgb(61, 61, 61)');
          expect(colours.onLevel).toBe(
            scheme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(218, 218, 218)',
          );
          await expectOneRed(page, `${scheme}, ${width} px, a level rising`);
          await expectNoSeriousA11y(page, `${scheme}, ${width} px, a level rising`);
          await midi.noteOff(48);
          await midi.noteOff(60);
        });
      }
    });
  }

  test('under reduced motion the level rises a beat at a time and drains at once', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const midi = await twinkle(page);
    await midi.waitForStep();

    // The whole note of the left hand is 4 beats (600 ms each): its level steps by quarters of
    // the key's 89 units (and 5 for the bar), with nothing between, until it is full.
    const sampled = await page.evaluate(async () => {
      const w = window as unknown as { __fakeMidi: { send(bytes: number[]): void } };
      const heights: number[] = [];
      w.__fakeMidi.send([0x90, 48, 100]);
      const started = performance.now();
      await new Promise<void>((resolve) => {
        const look = () => {
          const el = document.querySelector('.keyboard .key[data-midi="48"] rect.key-level');
          const h = el ? Number(el.getAttribute('height')) : null;
          if (h !== null) heights.push(h);
          if ((h !== null && h >= 94) || performance.now() - started > 8_000) resolve();
          else requestAnimationFrame(look);
        };
        look();
      });
      return heights;
    });
    const steps = [...new Set(sampled.map((h) => Math.round(h * 100) / 100))].sort((a, b) => a - b);
    expect(steps, `heights seen: ${sampled}`).toEqual([0, 27.25, 49.5, 71.75, 94]);
    await midi.noteOff(48);
    await expect(level(page, 48)).toHaveCount(0, { timeout: 1_000 });

    // Let go part of the way: gone in the next frames, with no drain.
    const gone = await page.evaluate(async () => {
      const w = window as unknown as { __fakeMidi: { send(bytes: number[]): void } };
      const el = () => document.querySelector('.keyboard .key[data-midi="48"] rect.key-level');
      w.__fakeMidi.send([0x90, 48, 100]);
      await new Promise<void>((resolve) => {
        const look = () =>
          el() && Number(el()!.getAttribute('height')) >= 27
            ? resolve()
            : requestAnimationFrame(look);
        look();
      });
      w.__fakeMidi.send([0x80, 48, 0]);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return el() === null;
    });
    expect(gone, 'the level was still there two frames after the key came up').toBe(true);
    await expectOneRed(page, 'reduced motion, the level gone');
  });

  test("nothing changes outside play-along: Play shows the reader's keys with no level", async ({
    page,
  }) => {
    const midi = await twinkle(page);
    await openPractice(page);
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    await closePractice(page);
    await midi.waitForStep();
    await play(page).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await midi.noteOn(60);
    await expect(heldBar(page, 60)).toHaveCount(1);
    await expect(page.locator('.keyboard rect.key-level')).toHaveCount(0);
    await expect(page.locator('.keyboard text.key-on-level')).toHaveCount(0);
    expect(await midi.index(), 'the walk is quiet while it plays').toBe(-1);
    await expectOneRed(page, 'playing, a key held');

    // After Pause the walk spends the held key as before: it neither fills nor counts.
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(play(page)).toBeVisible();
    await midi.waitForStep();
    const was = await midi.index();
    await staysAt(page, midi, was, 'the key held through Play counted for a step');
    await expect(page.locator('.keyboard rect.key-level')).toHaveCount(0);
    await midi.noteOff(60);
    await midi.playRed();
    expect(await midi.index()).not.toBe(was);
    await expectOneRed(page, 'moved on after the pause');
  });

  test('without a piano the score has no levels and Play plays as before', async ({ page }) => {
    const midi = await twinkle(page, { playAlong: false });
    await expect(page.locator('.keyboard rect.key-level')).toHaveCount(0);
    expect(await midi.target()).toEqual([]);
    expect(await midi.index()).toBe(-1);
    await openPractice(page);
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    await closePractice(page);
    await play(page).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await expect.poll(() => positionSec(page)).toBeGreaterThan(0.3);
    await expect(page.locator('.keyboard rect.key-level')).toHaveCount(0);
    await expectOneRed(page, 'playing with no piano');
  });
});

/**
 * Waits as long as the step the red waits on is held for, and a little more, and checks that the
 * walk is still on `index`: a key that does not count (the wrong one, one held through a move, a
 * key without its partner) leaves the red where it is however long it is held.
 */
async function staysAt(
  page: Page,
  midi: ReturnType<typeof fakeMidi>,
  index: number,
  message = 'the red moved on',
): Promise<void> {
  await page.waitForTimeout((await midi.hold()) + 300);
  expect(await midi.index(), message).toBe(index);
}

/**
 * Samples the screen's red elements again and again (one sample per round trip to the page), from
 * now until the returned function is called (and awaited): exactly one red in every sample, or
 * the call throws what the sample found.
 */
function sampleRed(page: Page, label: string): () => Promise<void> {
  let stop = false;
  let failure: unknown = null;
  const sampling = (async () => {
    try {
      while (!stop) await expectOneRed(page, label);
    } catch (error) {
      failure = error;
    }
  })();
  return async () => {
    stop = true;
    await sampling;
    if (failure) throw failure;
  };
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

/** Waits until the page has stopped scrolling (ten frames at one `scrollY`) and returns it. */
function scrollSettled(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let last = window.scrollY;
        let still = 0;
        const tick = () => {
          const y = window.scrollY;
          still = y === last ? still + 1 : 0;
          last = y;
          if (still >= 10) resolve(y);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}
