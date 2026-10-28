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
  walkTiming,
  type AccompaniedNote,
  type FakeMidiOptions,
} from './helpers/midi.js';
import { closePractice, embellishDecided, openPractice, setLoopBars } from './helpers/practice.js';
import { horizontalOverflow } from './helpers/overflow.js';
import { expectOneRed } from './helpers/red.js';
import { delayPianoSamples, PIANO_SAMPLES } from './helpers/samples.js';
import { positionSec, redBars, redSettled, seekBar } from './helpers/seek.js';

// Playing along on the reader's own piano (issue 182): a digital piano over Web MIDI, here a
// fake that the test drives (helpers/midi.ts). The home line asks the browser only when pressed;
// in the score the red waits for the notes of the next group, and moves on at the press of
// them all. Twinkle's steps, in performance order, start [48 60] [60] [67] [67] [53 69] [69]
// [48 67] [53 65] [65] [48 64] [64] [55 62] [62] [48 60] (bars 1 to 4); every score flow runs
// with `?audio=silent`, and `strikes()` stays empty throughout: the app makes no sound for the
// reader's notes. With one hand left out and the Practice panel's `Hear the left hand` / `Hear
// the right hand` switch on (issue 231; off by default), digitus plays that hand (issue 184)
// between the reader's steps, counted from the press that passes each step; `accompanied()` and
// `accompCancelled()` read what it handed to the instrument and what it dropped (helpers/midi.ts).
// The tests that expect that sound seed the switch on (`HEAR`).

const TWINKLE = 'twinkle-twinkle-little-star';
const TWINKLE_NOTES = 64;
/** A two-handed piece whose left hand moves: bars of its own, not Twinkle's sparse one. */
const MINUET = 'bach-minuet-g-major-bwv-anh-114';
const BWV994 = 'bach-applicatio-c-major-bwv-994';
/** The Practice tempo at its top, 150 %: every gap is two thirds as long (issue 204). */
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

  /**
   * A watcher in the page that sees even a flight home or a red Play that lasts a few frames,
   * which a poll between two round trips could miss: `sawHome` reads whether one showed.
   */
  function watchForHome(page: Page): Promise<void> {
    return page.evaluate(() => {
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
  }
  const sawHome = (page: Page): Promise<boolean | undefined> =>
    page.evaluate(() => (window as unknown as { __sawHome?: boolean }).__sawHome);

  /** The written second of the group the red marks (the test hook). */
  function cursorSec(page: Page): Promise<number> {
    return page.evaluate(() =>
      (window as unknown as { __digitus2: { cursorSec(): number } }).__digitus2.cursorSec(),
    );
  }

  /** The reader's key on the on-screen keyboard: the gray bar along its front edge. */
  const heldBar = (page: Page, midi: number): Locator =>
    page.locator(`.keyboard .key[data-midi="${midi}"] .key-held`);

  test('the first group waits, red, and moves on at the press of every note of it', async ({
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
    await watchForHome(page);
    await page.keyboard.press('Home');
    await seekBar(page, 0);
    const until = Date.now() + 600;
    while (Date.now() < until)
      await expectOneRed(page, 'Home and bar 1 while the first group waits');
    expect(await sawHome(page), 'the red flew home, or Play took it').toBe(false);
    expect(await cursorSec(page)).toBe(0);
    expect(await midi.index()).toBe(0);

    // One of the two notes does not move it, however long it is held; both held do, at the press
    // of the second (issue 204).
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
    // fresh press.
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

  test("with a loop set, Rewind and Home have nowhere to go on the loop's first group (issue 196)", async ({
    page,
  }) => {
    const midi = await twinkle(page, { tempo: FAST });
    await setLoopBars(page, '2', '3');
    await closePractice(page);
    await expect.poll(() => midi.index()).toBe(4); // the loop's first group, not the piece's
    await midi.waitForStep();
    await expect(rewind(page)).toHaveAttribute('aria-disabled', 'true');
    const at = await cursorSec(page);
    expect(at).toBeGreaterThan(0);

    // As on the piece's first group: the red does not fly home and come back, and Play is never
    // red meanwhile.
    await watchForHome(page);
    await page.keyboard.press('Home');
    await rewind(page).click({ force: true }); // aria-disabled: Playwright waits for it to end
    const until = Date.now() + 600;
    while (Date.now() < until) await expectOneRed(page, 'Home and Rewind on the loop first group');
    expect(await sawHome(page), 'the red flew home, or Play took it').toBe(false);
    await expect(rewind(page)).toHaveAttribute('aria-disabled', 'true');
    expect(await cursorSec(page)).toBe(at);
    expect(await midi.index()).toBe(4);
    expect(await redBars(page)).toEqual([1]);

    // A click on the loop's first bar, and Left at the loop's start (it clamps to that bar), land
    // on the group the red already waits on: no flight there and back either.
    await seekBar(page, 1);
    await page.keyboard.press('ArrowLeft');
    const again = Date.now() + 600;
    while (Date.now() < again) await expectOneRed(page, 'the loop first bar again');
    expect(await sawHome(page), 'a hop of no distance was planned').toBe(false);
    await expect(rewind(page)).toHaveAttribute('aria-disabled', 'true');
    expect(await cursorSec(page)).toBe(at);
    expect(await midi.index()).toBe(4);

    // One group on, Rewind is available again.
    await midi.playRed();
    await expect.poll(() => midi.index()).toBe(5);
    await expect(rewind(page)).not.toHaveAttribute('aria-disabled', 'true');
  });

  test.describe('a loop below the first screen (issue 196)', () => {
    test.use({ viewport: { width: 1280, height: 600 } });

    test("Home on the loop's first group leaves the page where the red is", async ({ page }) => {
      const midi = await twinkle(page, { tempo: FAST });
      await setLoopBars(page, '9', '12');
      await closePractice(page);
      await expect.poll(() => midi.index()).toBe(28); // the loop's first group
      await midi.waitForStep();
      const redInView = () =>
        page.evaluate(() => {
          const reds = [...document.querySelectorAll('.score-sheet .is-red')];
          return {
            count: reds.length,
            inView: reds.every((r) => {
              const b = r.getBoundingClientRect();
              return b.top >= 0 && b.bottom <= window.innerHeight;
            }),
            scrollY: window.scrollY,
          };
        });
      // The page follows the red down to the loop, and settles with it on screen.
      await expect
        .poll(async () => {
          const seen = await redInView();
          return seen.count > 0 && seen.inView && seen.scrollY > 100;
        })
        .toBe(true);

      await page.keyboard.press('Home');
      await page.waitForTimeout(500); // a smooth scroll to the top would take this long
      const after = await redInView();
      expect(after.scrollY, 'the page jumped to the top').toBeGreaterThan(100);
      expect(after.inView, 'the red went off screen').toBe(true);
      expect(await midi.index()).toBe(28);
    });
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
        expect(
          (await walkTiming(page).steps())[0]!.holdMs,
          'the Practice tempo was not seeded',
        ).toBeCloseTo(400, 0);
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
            // The noteheads, not the marked groups: a halo inside the cued note does not grow the box.
            const heads = [...document.querySelectorAll('.score-sheet .is-red .notehead')];
            const rects = heads.map((el) => el.getBoundingClientRect());
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

  // The play-along makes no sound at all: the reader's piano sounds its own notes, and the hand
  // left out of the Hands control is not played. A key clicked on the on-screen keyboard is the
  // control: it makes the AudioContext, so 'none' is not a hook that cannot see one.
  test('with one hand chosen and the steps passing, the app makes no sound: no AudioContext exists', async ({
    page,
  }) => {
    const midi = await twinkle(page, { settings: { hands: 'R' } });
    expect(await midi.waitForStep()).toEqual([60]);
    for (let i = 0; i < 6; i++) await midi.playRed();
    expect(await midi.index()).toBe(6);
    await page.waitForTimeout(500);
    expect(await audioState(page)).toBe('none');
    expect(await strikes(page)).toEqual([]);
    await expectOneRed(page, 'six steps passed, no audio');

    await page.locator('.keyboard .key[data-midi="60"] rect').first().click();
    await expect.poll(() => audioState(page)).not.toBe('none');
  });

  // ---------------------------------------------------------------------------------------
  // The other hand (issue 184). With one hand left out and the switch on, digitus plays it between
  // the reader's steps, counted from the press that passes each step. The fixture is Twinkle at 100 qpm, a
  // quarter note 0.6 s, a bar 2.4 s. Right hand chosen (the reader plays the right, digitus the left): every left-hand
  // note falls on a step of the right hand, so each stretch holds at most one note, at the
  // press. Left hand chosen (the reader plays the left, digitus the right): the steps are
  // [48]@0, [53]@2.4, [48]@3.6, [53]@4.8, [48]@6.0 ... and the right hand between them gives
  // stretches with several notes. Stretch of step 0, [0, 2.4): 60@0, 60@0.6, 67@1.2, 67@1.8.
  // Stretch of step 1, [2.4, 3.6): 69@2.4, 69@3.0. Of step 3, [4.8, 6.0): 65@4.8, 65@5.4. The
  // times are on the audio clock: press + offset / tempo, so differences are exact (asserted to
  // the millisecond). `accompCancelled()` holds the notes dropped from the queue before they
  // were handed over, then those cancelled or released after.
  // ---------------------------------------------------------------------------------------

  /** The reader turned on `Hear the left hand` / `Hear the right hand` (issue 231), seeded. */
  const HEAR = { hearOtherHand: true };

  /** The reader plays the left hand, and the Practice tempo is 50 % (stored, never clicked). */
  const HALF = { hands: 'L', ...HEAR, tempoByPiece: { [`piece:${TWINKLE}`]: 0.5 } };

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
    const midi = await twinkle(page, { settings: { hands: 'R', ...HEAR } });
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
    const midi = await twinkle(page, { settings: { hands: 'L', ...HEAR } });
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
    // The next step, pressed: its stretch counts from that press.
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
    const midi = await twinkle(page, { settings: { hands: 'L', ...HEAR } });
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

  test('the next press drops the notes that have not started and counts from its own press', async ({
    page,
  }) => {
    const midi = await twinkle(page, { settings: HALF });
    await soundReady(page);
    // The step passes at the press (issue 204) and its stretch starts there: 60 sounds now; 60, 67
    // and 67 wait 1.2, 2.4 and 3.6 s at 50 %.
    await midi.pressStep();
    await expect.poll(() => accompanied(page)).toHaveLength(1);
    expect(await accompCancelled(page)).toEqual([]);
    // The next step, pressed at once, hands over its own stretch from its press.
    await midi.pressStep();
    await expect.poll(() => accompanied(page)).toHaveLength(2);
    const [first, second] = await accompanied(page);
    expect(first).toMatchObject({ midi: 60, hand: 'R' });
    expect(second).toMatchObject({ midi: 69, hand: 'R' });
    // The queue's three notes were dropped; the note that had started is not among them.
    const dropped = await accompCancelled(page);
    expect(dropped.map((n) => n.midi)).toEqual([60, 67, 67]);
    expect(dropped.map((n) => ms(n.time - first!.time))).toEqual([1200, 2400, 3600]);
    // The second stretch counts from the second press: 69 again 0.6 s on, at 50 %.
    await expect.poll(() => accompanied(page)).toHaveLength(3);
    const all = await accompanied(page);
    expect(all[2]).toMatchObject({ midi: 69 });
    expect(ms(all[2]!.time - second!.time)).toBe(1200);
    await expectOneRed(page, 'after the second press');
  });

  test('a click on a bar drops them, and nothing sounds until the next press', async ({ page }) => {
    const midi = await twinkle(page, { settings: HALF });
    await soundReady(page);
    // The step passes at the press (issue 204) and its stretch starts there; the red waits on step 1
    // when the reader clicks the bar.
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
    await midi.pressStep({ wait: false }); // the step passes at the press: the stretch is handed over
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
    const midi = await twinkle(page, { settings: { hands: 'L', ...HEAR } });
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
    await midi.pressStep(); // the step passes at the press (issue 204): its stretch is handed over and the red moves to step 1
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
    expect(await midi.waitForStep()).toEqual([53]); // the step the press moved the red to
    expect(await cursorSec(page)).toBe(cue);
    expect(await accompanied(page)).toHaveLength(1);
  });

  // The real instrument (`?hooks=1`) with the samples served late. Loading them for the other
  // hand is `preparing`, never `loading`: the walk is not turned off, Play is not busy.
  test('while the piano loads for the other hand the line says so and the red goes on moving', async ({
    page,
  }) => {
    const requested = await delayPianoSamples(page, 3_000);
    const midi = await twinkle(page, { settings: { hands: 'R', ...HEAR } }, 'hooks=1');
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
    const midi = await twinkle(page, { settings: { hands: 'R', ...HEAR } }, 'hooks=1');
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

  // A step passes at the press of its keys (issue 204), and the held keys fill over their notes'
  // lengths (issue 185). Twinkle's first step is [48 60] at 100 qpm: a quarter is 600 ms, and the
  // left hand's C is a whole note of 4 beats.

  /** A key's level, the fill that rises inside it while the reader holds it. */
  const level = (page: Page, midi: number): Locator =>
    page.locator(`.keyboard .key[data-midi="${midi}"] rect.key-level`);
  /** The finger number or hand letter drawn again over the level, in the light gray. */
  const levelText = (page: Page, midi: number): Locator =>
    page.locator(`.keyboard .key[data-midi="${midi}"] text.key-on-level`);

  test('a step passes at its press, in the same task as the note, and a release asks for nothing', async ({
    page,
  }) => {
    const midi = await twinkle(page);
    await midi.waitForStep();
    await expect(page.getByRole('status')).toHaveText(HINT_MANY);

    // Both keys go down in one task (all in the page, so a slow round trip cannot separate the
    // press from the look): the red is on the next step right after.
    const after = await page.evaluate(() => {
      const w = window as unknown as {
        __digitus2Along: { index(): number };
        __fakeMidi: { send(bytes: number[]): void };
      };
      w.__fakeMidi.send([0x90, 48, 100]);
      w.__fakeMidi.send([0x90, 60, 100]);
      return w.__digitus2Along.index();
    });
    expect(after, 'the step did not pass at the press').toBe(1);

    // The keys come up: nothing is asked for, and the red stays where it is.
    await midi.noteOff(48);
    await midi.noteOff(60);
    await expect(page.getByRole('status')).toHaveText('');
    expect(await midi.index()).toBe(1);
    await expectOneRed(page, 'the keys let go');
    await expectNoSeriousA11y(page, 'the keys let go');
    expect(await strikes(page)).toEqual([]);
  });

  test("a key fills over its note's length, is full, and drains when let go early", async ({
    page,
  }) => {
    const midi = await twinkle(page);
    await midi.waitForStep();
    await midi.noteOn(50); // a wrong note: its bar, never a level
    await expect(heldBar(page, 50)).toHaveCount(1);

    // Both keys of the first step go down and the page watches, frame by frame, for 700 ms (a
    // quarter at 100 qpm is 600 ms): the left hand's whole note fills slowly, the right hand's
    // quarter is full by then.
    const watched = await page.evaluate(async () => {
      const w = window as unknown as {
        __fakeMidi: { send(bytes: number[]): void };
      };
      const heightOf = (m: number): number | null => {
        const el = document.querySelector(`.keyboard .key[data-midi="${m}"] rect.key-level`);
        return el ? Number(el.getAttribute('height')) : null;
      };
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
          if (performance.now() - started > 700) resolve();
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
    // The red has moved on (step 1 asks for 60 again): 60's note is over, so its key is full (94
    // units, the key's height less its insets); 48's whole note is a quarter of the way (5 units
    // of bar and 89 to fill: 27.25 at 0.25).
    expect(watched.now[60]).toBeCloseTo(94, 0);
    const fraction = (watched.now[48]! - 5) / 89;
    expect(fraction, `48 filled to ${watched.now[48]}`).toBeGreaterThan(0.2);
    expect(fraction, `48 filled to ${watched.now[48]}`).toBeLessThan(0.4);
    // 48 is let go early, right away: on a slow machine the checks below could outlast its whole
    // note. It drains to nothing over --dur-slow (200 ms), shrinking all the way.
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
    expect(drained.heights[0], `48 was full before it was let go: ${drained.heights}`).toBeLessThan(
      90,
    );
    expect(drained.heights.length, `heights while draining: ${drained.heights}`).toBeGreaterThan(1);
    for (let i = 2; i < drained.heights.length; i++)
      expect(drained.heights[i]!).toBeLessThanOrEqual(drained.heights[i - 1]! + 0.01);
    expect(drained.heights.at(-1)!).toBeLessThan(drained.heights[0]!);
    expect(drained.ms, 'the level went before its drain').toBeGreaterThanOrEqual(150);
    expect(drained.ms, 'the level stayed after its drain').toBeLessThan(1_500);
    await expect(level(page, 48)).toHaveCount(0);
    await expect(levelText(page, 48)).toHaveCount(0);

    await expect.poll(() => midi.target()).toEqual([60]);

    // The finger number was drawn again over the level on 60 while its step was asked for (48 is
    // no longer shown pressed once the step has passed, so its copy is gone with the number); 60 is
    // asked for again. The wrong note has no level.
    expect(watched.numbers[60]).toMatch(/^[1-5]$/);
    await expect(levelText(page, 60)).toHaveCount(1);
    await expect(levelText(page, 60)).toHaveText(/^[1-5]$/);
    await expect(level(page, 50)).toHaveCount(0);
    await expect(heldBar(page, 50)).toHaveCount(1);
    await expectOneRed(page, 'the keys filling');
    await expectNoSeriousA11y(page, 'the keys filling');

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

          // Both keys held: the levels rise (48's for 2.4 s, and 60's stays once full). The step
          // passes at the press and 48 stops being shown pressed, so the page reads the colours as
          // soon as 60's number is drawn over its level (step 1 asks for 60 again).
          const colours = await page.evaluate(async () => {
            const w = window as unknown as { __fakeMidi: { send(bytes: number[]): void } };
            const copy = (m: number) =>
              document.querySelector(`.keyboard .key[data-midi="${m}"] text.key-on-level`);
            for (const m of [48, 60]) w.__fakeMidi.send([0x90, m, 100]);
            const started = performance.now();
            await new Promise<void>((resolve) => {
              const look = () =>
                copy(60) || performance.now() - started > 3_000
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
              text60: fill('.keyboard .key[data-midi="60"] text.key-on-level'),
            };
          });
          expect(colours.level48).toBe(colours.held);
          expect(colours.level60).toBe(colours.held);
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

  // ---------------------------------------------------------------------------------------
  // Practice mode (issue 191): a switch heading the Practice panel while a piano is connected.
  // Off, the score page is as with no piano; the piano stays connected and its keys still show.
  // ---------------------------------------------------------------------------------------

  const practiceSwitch = (page: Page): Locator =>
    page.getByRole('switch', { name: 'Practice mode' });

  /** Opens the panel, flips the switch with a click, and closes the panel again. */
  async function flipPractice(page: Page, to: boolean): Promise<void> {
    await openPractice(page);
    await practiceSwitch(page).click();
    if (to) await expect(practiceSwitch(page)).toBeChecked();
    else await expect(practiceSwitch(page)).not.toBeChecked();
    await closePractice(page);
  }

  test('the switch shows only while a piano is connected, on, and heads the panel', async ({
    page,
  }) => {
    const midi = await twinkle(page);
    await openPractice(page);
    await expect(practiceSwitch(page)).toBeChecked();
    // The first control of the panel, before Tempo.
    await expect(page.locator('.practice-panel input').first()).toHaveAttribute('role', 'switch');
    await expectOneRed(page, 'the switch on');

    // The piano goes while the switch has the focus: the focus moves to Tempo, not to the page.
    await practiceSwitch(page).focus();
    await midi.unplug();
    await expect(practiceSwitch(page)).toHaveCount(0);
    await expect(page.getByRole('slider', { name: 'Tempo' })).toBeFocused();
    await midi.plug(PIANO);
    await expect(practiceSwitch(page)).toBeChecked();
    await expectOneRed(page, 'the piano back');
  });

  test('with no piano there is no switch', async ({ page }) => {
    await twinkle(page, { playAlong: false });
    await openPractice(page);
    await expect(page.getByRole('slider', { name: 'Tempo' })).toBeVisible();
    await expect(page.getByRole('switch')).toHaveCount(0);
  });

  test('off hands the page back: Play plays, the red follows the music, the keys still show', async ({
    page,
  }) => {
    const midi = await twinkle(page);
    await midi.playRed();
    await midi.playRed();
    expect(await midi.waitForStep()).toEqual([67]);
    const cue = await cursorSec(page);
    await openPractice(page);
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    await practiceSwitch(page).click();
    await expect(practiceSwitch(page)).not.toBeChecked();
    await closePractice(page);

    // The walk is off: nothing is asked, the cue stays, no level, no hint. Play is plain.
    await expect.poll(() => midi.target()).toEqual([]);
    expect(await cursorSec(page)).toBe(cue);
    await expect(page.locator('.keyboard rect.key-level')).toHaveCount(0);
    await expect(page.getByRole('status')).toHaveText('');
    await expect(play(page)).not.toHaveClass(/is-red/);
    await expectOneRed(page, 'Practice mode off, the cue stays');

    // A key pressed shows on the keyboard and moves nothing.
    await midi.noteOn(67);
    await expect(heldBar(page, 67)).toHaveCount(1);
    await page.waitForTimeout(500);
    expect(await cursorSec(page)).toBe(cue);
    expect(await midi.index()).toBe(-1);
    await expect(page.locator('.keyboard rect.key-level')).toHaveCount(0);
    await midi.noteOff(67);
    await expect(heldBar(page, 67)).toHaveCount(0);

    // Play plays past the cue; Pause keeps the red where the music was.
    await play(page).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await expect.poll(() => cursorSec(page)).toBeGreaterThan(cue);
    await expectOneRed(page, 'playing with Practice mode off');
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(play(page)).toBeVisible();
    await expect(page.locator('.score-sheet .is-red').first()).toBeVisible();
    await expect(play(page)).not.toHaveClass(/is-red/);
    expect(await midi.target()).toEqual([]);
    expect(await strikes(page)).toEqual([]);
    await expectOneRed(page, 'paused with Practice mode off');
  });

  test('on again the walk goes on from the red, and a key held through the switch does not count', async ({
    page,
  }) => {
    const midi = await twinkle(page);
    await midi.playRed();
    await midi.playRed();
    expect(await midi.waitForStep()).toEqual([67]);
    expect(await midi.index()).toBe(2);
    await flipPractice(page, false);
    await expect.poll(() => midi.target()).toEqual([]);
    await midi.noteOn(67); // held while it is off, and through the switch
    await flipPractice(page, true);
    expect(await midi.waitForStep()).toEqual([67]);
    expect(await midi.index()).toBe(2);
    await page.waitForTimeout(1_200);
    expect(await midi.index(), 'the key held through the switch counted').toBe(2);
    await expect(page.locator('.keyboard rect.key-level')).toHaveCount(0);
    await midi.noteOff(67);
    await midi.playRed(); // a fresh press moves it
    expect(await midi.index()).toBe(3);
    await expectOneRed(page, 'on again, one step on');
  });

  test('off stops digitus, and nothing more is handed over', async ({ page }) => {
    const midi = await twinkle(page, { settings: HALF });
    await soundReady(page);
    await midi.pressStep(); // the step passes at the press: the other hand is handed over
    await expect.poll(() => accompanied(page)).toHaveLength(1);
    const before = (await accompCancelled(page)).length;
    await flipPractice(page, false);
    await expect.poll(async () => (await accompCancelled(page)).length).toBeGreaterThan(before);
    await expect.poll(() => midi.target()).toEqual([]);
    await midi.noteOff(48);
    await midi.noteOn(48);
    await page.waitForTimeout(600);
    expect(await accompanied(page)).toHaveLength(1);
    expect(await strikes(page)).toEqual([]);
    await expectOneRed(page, 'off, digitus stopped');
  });

  test('off is remembered across a reload', async ({ page }) => {
    const midi = await twinkle(page);
    await flipPractice(page, false);
    await page.reload();
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(TWINKLE_NOTES, {
      timeout: 20_000,
    });
    await expect(play(page)).toBeEnabled();
    await openPractice(page);
    await expect(practiceSwitch(page)).not.toBeChecked();
    expect(await midi.target()).toEqual([]);
    await expectOneRed(page, 'off after a reload');
  });

  // The switch drawn: ink and grays, both themes, a desktop's width and a phone's; at 360 px in
  // French the row keeps its 44 px and its label stays beside the switch.
  for (const [width, height, locale] of [
    [1280, 900, 'en-US'],
    [360, 740, 'en-US'],
    [360, 740, 'fr-FR'],
  ] as const) {
    test.describe(`the switch at ${width} px, ${locale}`, () => {
      test.use({ viewport: { width, height }, locale });

      for (const scheme of ['light', 'dark'] as const) {
        test(`in the ${scheme} theme it is drawn in ink and grays, one red throughout`, async ({
          page,
        }) => {
          await page.emulateMedia({ colorScheme: scheme });
          const french = locale === 'fr-FR';
          if (french) {
            // The page speaks French: twinkle() finds Play by its English name.
            await installFakeMidi(page, { permission: 'granted', playAlong: true });
            await page.goto(`/?audio=silent#/piece/${TWINKLE}`);
            await expect(page.locator('.score-sheet g.fing')).toHaveCount(TWINKLE_NOTES, {
              timeout: 20_000,
            });
            await embellishDecided(page, 'offered');
          } else {
            await (await twinkle(page)).waitForStep();
          }
          const name = french ? 'Mode exercice' : 'Practice mode';
          const toggle = page.getByRole('switch', { name });
          await openPractice(page);
          await expect(toggle).toBeChecked();
          const label = toggle.locator('xpath=..');
          const looks = () =>
            toggle.evaluate((input) => {
              const tokenColour = (token: string): string => {
                const probe = document.createElement('span');
                probe.style.color = `var(${token})`;
                document.body.appendChild(probe);
                const colour = getComputedStyle(probe).color;
                probe.remove();
                return colour;
              };
              const track = getComputedStyle(input);
              const thumb = getComputedStyle(input, '::before');
              return {
                appearance: track.appearance,
                track: track.backgroundColor,
                border: track.borderTopColor,
                thumb: thumb.backgroundColor,
                ink: tokenColour('--ink'),
                paper: tokenColour('--paper'),
                gray3: tokenColour('--gray-3'),
              };
            });

          for (const on of [true, false, true]) {
            if ((await toggle.isChecked()) !== on) await toggle.click();
            // The thumb slides over --dur-fast (120 ms): read the colours once it has settled.
            await page.waitForTimeout(250);
            const seen = await looks();
            const where = `${scheme}, ${width} px, ${locale}, switch ${on ? 'on' : 'off'}`;
            expect(seen.appearance, where).toBe('none');
            expect(seen.border, where).toBe(seen.ink);
            expect(seen.track, where).toBe(on ? seen.ink : seen.paper);
            expect(seen.thumb, where).toBe(on ? seen.paper : seen.gray3);
            const box = (await label.boundingBox())!;
            expect(box.height, where).toBeGreaterThanOrEqual(44);
            // The words stay on one row beside the switch (a wrapped label would still be 44 px
            // high): the switch's and every text line's vertical centres agree within 2 px.
            const rows = await label.evaluate((el) => {
              const range = document.createRange();
              range.selectNodeContents(el);
              const centres = [...range.getClientRects()]
                .filter((r) => r.width > 0 && r.height > 0)
                .map((r) => r.top + r.height / 2);
              return { count: centres.length, spread: Math.max(...centres) - Math.min(...centres) };
            });
            expect(rows.count, where).toBeGreaterThanOrEqual(2); // the switch and the words
            expect(rows.spread, `${where}, the label wraps`).toBeLessThanOrEqual(2);
            expect(await horizontalOverflow(page), where).toBeLessThanOrEqual(0);
            await expectOneRed(page, where);
            await expectNoSeriousA11y(page, where);
          }
        });
      }
    });
  }

  // ---------------------------------------------------------------------------------------
  // `Hear the left hand` / `Hear the right hand` (issue 231): the switch that lets digitus play the
  // hand the reader left out. It is stacked right over the Hands control, in the Practice panel,
  // and there only with a piano connected, Practice mode on, a two-handed piece and one hand
  // chosen; it is off until the reader turns it on, and saved. The sound itself is in
  // play-along-sound.spec.ts and above (those tests seed it on).
  // ---------------------------------------------------------------------------------------

  /** Minuet in G open with the fake piano: a left hand that moves, as the owner's rule asks. */
  async function minuet(
    page: Page,
    fake: FakeMidiOptions = {},
  ): Promise<ReturnType<typeof fakeMidi>> {
    await installFakeMidi(page, { permission: 'granted', playAlong: true, ...fake });
    await page.goto(`/?audio=silent#/piece/${MINUET}`);
    await minuetReady(page);
    return fakeMidi(page);
  }
  /** The score is drawn and Play can start: the same after a reload. */
  async function minuetReady(page: Page): Promise<void> {
    await expect(page.locator('.score-sheet g.fing').first()).toBeVisible({ timeout: 20_000 });
    await expect(play(page)).toBeEnabled();
    await embellishDecided(page);
  }

  const hearSwitch = (page: Page, hand: 'left' | 'right'): Locator =>
    page.getByRole('switch', { name: `Hear the ${hand} hand` });
  const anyHearSwitch = (page: Page): Locator =>
    page.getByRole('switch', { name: /^Hear the (left|right) hand$/ });

  test('the Hear switch shows only with a piano, Practice mode on and one hand chosen, off at first', async ({
    page,
  }) => {
    const midi = await minuet(page);
    await openPractice(page);
    // Both hands: nothing is left out, so nothing to hear.
    await expect(page.getByRole('radio', { name: 'Both hands' })).toBeChecked();
    await expect(anyHearSwitch(page)).toHaveCount(0);

    // The reader plays the right hand: the left is the one that would sound.
    await page.getByRole('radio', { name: 'Right hand' }).check();
    await expect(hearSwitch(page, 'left')).toBeVisible();
    await expect(hearSwitch(page, 'left')).not.toBeChecked();
    await expect(anyHearSwitch(page)).toHaveCount(1);
    await expectOneRed(page, 'the right hand chosen, the switch off');
    // The left hand chosen: the right hand is the one that would sound; still off.
    await page.getByRole('radio', { name: 'Left hand' }).check();
    await expect(hearSwitch(page, 'right')).toBeVisible();
    await expect(hearSwitch(page, 'right')).not.toBeChecked();
    await expect(anyHearSwitch(page)).toHaveCount(1);
    await page.getByRole('radio', { name: 'Both hands' }).check();
    await expect(anyHearSwitch(page)).toHaveCount(0);

    // Practice mode off: the page is as with no piano, and the switch goes.
    await page.getByRole('radio', { name: 'Right hand' }).check();
    await expect(hearSwitch(page, 'left')).toBeVisible();
    await practiceSwitch(page).click();
    await expect(practiceSwitch(page)).not.toBeChecked();
    await expect(anyHearSwitch(page)).toHaveCount(0);
    await practiceSwitch(page).click();
    await expect(hearSwitch(page, 'left')).toBeVisible();

    // The piano goes while the switch has the focus: the focus moves to the checked hand.
    await hearSwitch(page, 'left').focus();
    await midi.unplug();
    await expect(anyHearSwitch(page)).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'Right hand' })).toBeFocused();
    await midi.plug(PIANO);
    await expect(hearSwitch(page, 'left')).toBeVisible();
    await expectOneRed(page, 'the piano back');
  });

  test('with no piano there is no Hear switch, whatever hand is chosen', async ({ page }) => {
    await minuet(page, { playAlong: false, settings: { hands: 'R' } });
    await openPractice(page);
    await expect(page.getByRole('radio', { name: 'Right hand' })).toBeChecked();
    await expect(anyHearSwitch(page)).toHaveCount(0);
  });

  test('the Hear switch is saved: on stays on across a reload, with a click it goes off again', async ({
    page,
  }) => {
    const midi = await minuet(page, { settings: { hands: 'R' } });
    await openPractice(page);
    await expect(hearSwitch(page, 'left')).not.toBeChecked();
    await hearSwitch(page, 'left').click();
    await expect(hearSwitch(page, 'left')).toBeChecked();
    await page.reload();
    await minuetReady(page);
    await midi.waitForStep();
    await openPractice(page);
    await expect(hearSwitch(page, 'left')).toBeChecked();
    await hearSwitch(page, 'left').click();
    await expect(hearSwitch(page, 'left')).not.toBeChecked();
    await page.reload();
    await minuetReady(page);
    await midi.waitForStep();
    await openPractice(page);
    await expect(hearSwitch(page, 'left')).not.toBeChecked();
    await expectOneRed(page, 'off after a reload');
  });

  // The switch is stacked over the Hands control, and the Hands control does not move when it
  // appears: the reader's pointer is on `Right hand` the moment it does. The panel grows upward
  // from Play, so the line that holds Hands grows at its top and every line after it stays. Read
  // on Minuet in G (a moving left hand), at a desktop's width and a phone's, in English and in
  // French (`Entendre la main gauche` against `Les deux | Droite | Gauche`).
  //
  // At 360 px choosing a hand also scrolls the page (the red is brought above the dock, whatever
  // the switch), and that moves everything on it by as much. So the switch's own effect is read
  // from the dock's bottom edge, which the panel grows away from: `Both hands` against `Right hand`
  // (the switch there), and `Right hand` against `Both hands` again (not there), with the page at
  // the same scroll. At 1280 px the page does not scroll, and the Hands box in the page itself
  // must be the same one before and after.
  for (const [width, height, locale] of [
    [1280, 900, 'en-US'],
    [360, 740, 'en-US'],
    [1280, 900, 'fr-FR'],
    [360, 740, 'fr-FR'],
  ] as const) {
    test.describe(`the Hear switch appears over Hands at ${width} px, ${locale}`, () => {
      test.use({ viewport: { width, height }, locale });

      test('the Hands control keeps its box when the switch appears', async ({ page }) => {
        const french = locale === 'fr-FR';
        const names = french
          ? {
              hands: 'Mains',
              both: 'Les deux',
              right: 'Droite',
              hear: 'Entendre la main gauche',
              metronome: 'Métronome',
              countIn: 'Décompte',
              loop: 'Boucle de mesures',
            }
          : {
              hands: 'Hands',
              both: 'Both hands',
              right: 'Right hand',
              hear: 'Hear the left hand',
              metronome: 'Metronome',
              countIn: 'Count-in',
              loop: 'Loop bars',
            };
        await installFakeMidi(page, { permission: 'granted', playAlong: true });
        await page.goto(`/?audio=silent#/piece/${MINUET}`);
        await expect(page.locator('.score-sheet g.fing').first()).toBeVisible({ timeout: 20_000 });
        await expect(page.locator('.dock .practice-toggle')).toBeVisible();
        await embellishDecided(page);
        await fakeMidi(page).waitForStep();
        await openPractice(page);

        const handsGroup = page.getByRole('group', { name: names.hands });
        const hear = page.getByRole('switch', { name: names.hear });
        // The rows of the controls that may share a line with Hands (Practice mode and Tempo), and
        // the rows after it (Metronome, Count-in, Loop bars), each 44 px high.
        const besideRows = [
          page.locator('.transport > .check.switch'),
          page.locator('.transport > .tempo'),
        ];
        const afterRows = [names.metronome, names.countIn, names.loop].map((name) =>
          page.getByRole('checkbox', { name }).locator('xpath=..'),
        );
        /** The page has stopped scrolling (five frames at one position), so boxes can be read. */
        const settle = () =>
          page.evaluate(
            () =>
              new Promise<void>((resolve) => {
                let last = -1;
                let still = 0;
                const tick = () => {
                  still = window.scrollY === last ? still + 1 : 0;
                  last = window.scrollY;
                  if (still >= 5) resolve();
                  else requestAnimationFrame(tick);
                };
                requestAnimationFrame(tick);
              }),
          );
        const read = async (l: Locator) => (await l.boundingBox())!;
        const dock = page.locator('.dock');
        /** The boxes, in the page and as distances above the dock's bottom edge. */
        const boxes = async () => {
          await settle();
          const box = await read(dock);
          const edge = box.y + box.height;
          const hands = await read(handsGroup);
          const beside = await Promise.all(besideRows.map(read));
          const after = await Promise.all(afterRows.map(read));
          const up = (b: { y: number; height: number }) => edge - (b.y + b.height);
          return {
            scrollY: await page.evaluate(() => window.scrollY),
            hands,
            beside,
            after,
            rel: { hands: up(hands), beside: beside.map(up), after: after.map(up) },
          };
        };

        // Both hands: no switch yet. This is the box the reader's pointer is over.
        await expect(hear).toHaveCount(0);
        const was = await boxes();
        expect(was.hands.height).toBeGreaterThanOrEqual(44);
        await page.getByRole('radio', { name: names.right }).check();
        await expect(hear).toBeVisible();
        const now = await boxes();
        const row = await read(hear.locator('xpath=..'));
        await page.getByRole('radio', { name: names.both }).check();
        await expect(hear).toHaveCount(0);
        const without = await boxes();

        // The switch is right over Hands: left edges together, one row and the panel's gap above.
        expect(row.x).toBe(now.hands.x);
        expect(row.height).toBeGreaterThanOrEqual(44);
        expect(row.y + row.height + 8).toBeCloseTo(now.hands.y, 0);
        const stack = row.height + 8;
        // The plan's transition, `Both hands` to `Right hand`, in the frame the page's own scroll
        // does not move: Hands is as far above the dock's bottom edge as it was, at both widths.
        expect(now.rel.hands).toBeCloseTo(was.rel.hands, 1);
        expect(now.rel.after.map((n) => Math.round(n))).toEqual(
          was.rel.after.map((n) => Math.round(n)),
        );
        // Hands does not move for it: as far above the dock's bottom as without it, and the same
        // across; nothing below it rewraps.
        expect(now.hands.x).toBe(without.hands.x);
        expect(now.hands.width).toBe(without.hands.width);
        expect(now.rel.hands).toBeCloseTo(without.rel.hands, 1);
        expect(now.rel.after.map((n) => Math.round(n))).toEqual(
          without.rel.after.map((n) => Math.round(n)),
        );
        expect(now.after.map((a) => a.x)).toEqual(without.after.map((a) => a.x));
        // What shares Hands' line (Practice mode and Tempo at 1280 px) sits at its bottom, level
        // with Hands, and stays; what stands on a line above (360 px) goes up by the row.
        for (const [i, gap] of without.rel.beside.entries()) {
          const sameLine = Math.abs(gap - without.rel.hands) < 1;
          if (sameLine)
            expect(now.rel.beside[i], `control ${i} level with Hands`).toBeCloseTo(gap, 1);
          else expect(now.rel.beside[i]!, `control ${i} above Hands`).toBeCloseTo(gap + stack, 1);
        }
        // Where the page does not scroll (1280 px), the boxes are the same ones in the page, and
        // the same as before the first click on Right hand.
        if (width === 1280) {
          expect(now.scrollY).toBe(was.scrollY);
          expect(without.hands).toEqual(was.hands);
          expect(now.hands).toEqual(was.hands);
          expect(now.after).toEqual(was.after);
        }
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
        await expectOneRed(page, 'the switch over Hands');
      });
    });
  }

  // ---------------------------------------------------------------------------------------
  // The key goes down (issue 200), and a release the key levels forgive leaves no drain (issue
  // 195). A key held on the piano goes further down than the cue alone: 0.94 for a white key,
  // 0.92 for a black one, and comes back to the cue's depth, or to rest. A release at four fifths
  // of the key's own note or later ends its level at once; an earlier one drains. The right hand
  // alone keeps each step to one key, and the Practice tempo at 50 % doubles every hold (1200 ms
  // for the first step), so every check has a wide margin on a slow machine. The timed parts run
  // inside the page.
  // ---------------------------------------------------------------------------------------

  const SLOW = { [TWINKLE]: 0.5 };
  const RIGHT = { settings: { hands: 'R' }, tempo: SLOW };

  /** The `scaleY` of a key as drawn now (its computed transform; 1 when it has none). */
  function travel(page: Page, midi: number): Promise<number> {
    return page.evaluate((m) => {
      const key = document.querySelector(`.keyboard g.key[data-midi="${m}"]`)!;
      const parsed = /^matrix\(([^)]+)\)$/.exec(getComputedStyle(key).transform);
      return parsed ? Number(parsed[1]!.split(',')[3]) : 1;
    }, midi);
  }

  /** Down for `ms` in the page, then up, then two frames: whether the key still has a level, and the elapsed ms. */
  function tapFor(
    page: Page,
    midi: number,
    ms: number,
  ): Promise<{ elapsed: number; level: boolean }> {
    return page.evaluate(
      async ([m, hold]) => {
        const w = window as unknown as { __fakeMidi: { send(bytes: number[]): void } };
        const started = performance.now();
        w.__fakeMidi.send([0x90, m!, 100]);
        await new Promise((r) => setTimeout(r, hold));
        const elapsed = performance.now() - started;
        w.__fakeMidi.send([0x80, m!, 0]);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return {
          elapsed,
          level:
            document.querySelector(`.keyboard g.key[data-midi="${m}"] rect.key-level`) !== null,
        };
      },
      [midi, ms] as const,
    );
  }

  test('a release at four fifths of its note ends the level at once; one that came too soon drains (issue 195)', async ({
    page,
  }) => {
    const midi = await twinkle(page, RIGHT);
    expect(await midi.waitForStep()).toEqual([60]);
    // A 1200 ms note, let go at 0.9 of it: the level is gone two frames later (a drain lasts 200 ms).
    const late = await tapFor(page, 60, 1080);
    expect(late.elapsed, 'the page ran the tap long: it is the PC').toBeLessThan(1_200);
    expect(late.level, 'a level lingered after a release past four fifths').toBe(false);
    await expect(level(page, 60)).toHaveCount(0);
    await expect.poll(() => midi.index()).toBe(1); // it passed at the press

    // The next step, let go at a third of its note: the level drains, then goes.
    const next = (await midi.waitForStep())[0]!;
    const soon = await tapFor(page, next, 400);
    expect(soon.elapsed, 'the page ran the tap long: it is the PC').toBeLessThan(0.8 * 1200);
    expect(soon.level, 'a release that came too soon did not drain').toBe(true);
    await expect(level(page, next)).toHaveCount(0, { timeout: 2_000 });
    await expectOneRed(page, 'a drain and a forgiven release');
  });

  test('a held key goes down further than the cue, a cued key let go returns to the cue depth, a wrong key travels too', async ({
    page,
  }) => {
    const midi = await twinkle(page, RIGHT);
    await midi.waitForStep();
    await expect.poll(() => travel(page, 60)).toBeCloseTo(0.976, 3); // the cue alone
    expect(await travel(page, 50)).toBe(1); // a key at rest

    await midi.noteOn(50); // a white key the step does not ask for
    await midi.noteOn(54); // and a black one
    await expect.poll(() => travel(page, 50)).toBeCloseTo(0.94, 3);
    await expect.poll(() => travel(page, 54)).toBeCloseTo(0.92, 3);
    await expect(level(page, 50)).toHaveCount(0);
    await midi.noteOff(50);
    await midi.noteOff(54);
    await expect.poll(() => travel(page, 50)).toBe(1); // to rest: nothing asks for it
    await expect.poll(() => travel(page, 54)).toBe(1);

    // The red note's key, held: deeper than the cue, in the page; let go too soon, it rises only
    // to the cue's depth and never above it.
    const rise = await page.evaluate(async () => {
      const w = window as unknown as { __fakeMidi: { send(bytes: number[]): void } };
      const key = document.querySelector('.keyboard g.key[data-midi="60"]')!;
      const depth = (): number => {
        const parsed = /^matrix\(([^)]+)\)$/.exec(getComputedStyle(key).transform);
        return parsed ? Number(parsed[1]!.split(',')[3]) : 1;
      };
      const frame = () => new Promise((r) => requestAnimationFrame(r));
      w.__fakeMidi.send([0x90, 60, 100]);
      // The press moves the cue to the next step, C4 again, which strikes the key once more
      // (110 ms): read the depth when no animation runs and it has stopped changing.
      let down = depth();
      let still = 0;
      const waited = performance.now();
      while (still < 4 && performance.now() - waited < 3_000) {
        await frame();
        const now = depth();
        still = key.getAnimations().length === 0 && Math.abs(now - down) < 1e-6 ? still + 1 : 0;
        down = now;
      }
      w.__fakeMidi.send([0x80, 60, 0]);
      const seen: number[] = [];
      const started = performance.now();
      while (performance.now() - started < 450) {
        seen.push(depth());
        await frame();
      }
      return { down, seen };
    });
    expect(rise.down, 'held, the cued key is deeper than the cue').toBeCloseTo(0.94, 3);
    for (const d of rise.seen) expect(d, `depths: ${rise.seen}`).toBeLessThanOrEqual(0.9761);
    for (let i = 1; i < rise.seen.length; i++)
      expect(rise.seen[i]!).toBeGreaterThanOrEqual(rise.seen[i - 1]! - 1e-6);
    expect(rise.seen.at(-1)!, `depths: ${rise.seen}`).toBeCloseTo(0.976, 3);
    expect(rise.seen.length, 'the rise was seen over several frames').toBeGreaterThan(3);
    await expectOneRed(page, 'a key let go');
  });

  test('on a piece with a moving left hand every key of the step goes down', async ({ page }) => {
    await installFakeMidi(page, { permission: 'granted', playAlong: true });
    await page.goto(`/?audio=silent#/piece/${MINUET}`);
    await expect(page.locator('.score-sheet g.fing').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled();
    const midi = fakeMidi(page);
    const isBlack = (p: number): boolean => [1, 3, 6, 8, 10].includes(p % 12);
    for (let step = 0; step < 4; step++) {
      const pitches = await midi.waitForStep();
      for (const p of pitches)
        await expect
          .poll(() => travel(page, p), `${p} cued`)
          .toBeCloseTo(isBlack(p) ? 0.96 : 0.976, 3);
      await midi.pressStep({ wait: false });
      for (const p of pitches)
        await expect
          .poll(() => travel(page, p), `${p} held`)
          .toBeCloseTo(isBlack(p) ? 0.92 : 0.94, 3);
      await expectOneRed(page, `minuet step ${step}, held`);
      for (const p of pitches) await midi.noteOff(p);
      await expect.poll(() => midi.index()).toBeGreaterThan(step);
    }
  });

  for (const [width, height] of [
    [1280, 900],
    [360, 740],
  ] as const) {
    test.describe(`the key goes down at ${width} px`, () => {
      test.use({ viewport: { width, height } });

      for (const scheme of ['light', 'dark'] as const) {
        test(`in the ${scheme} theme a held wrong key travels and takes no gray, one red throughout`, async ({
          page,
        }) => {
          await page.emulateMedia({ colorScheme: scheme });
          const midi = await twinkle(page, RIGHT);
          await midi.waitForStep();
          const where = `${scheme}, ${width} px, keys down`;
          const fill = (m: number): Promise<string> =>
            page.evaluate(
              (k) =>
                getComputedStyle(
                  document.querySelector(`.keyboard g.key[data-midi="${k}"] > rect`)!,
                ).fill,
              m,
            );
          const [rest50, rest54] = [await fill(50), await fill(54)];
          await midi.noteOn(50);
          await midi.noteOn(54);
          await expect.poll(() => travel(page, 50)).toBeCloseTo(0.94, 3);
          await expect.poll(() => travel(page, 54)).toBeCloseTo(0.92, 3);
          await page.waitForTimeout(300); // past every fill transition
          expect(await fill(50), 'a held white key took a gray').toBe(rest50);
          expect(await fill(54), 'a held black key took a gray').toBe(rest54);
          await expectOneRed(page, where);
          await expectNoSeriousA11y(page, where);
          expect(await horizontalOverflow(page), where).toBeLessThanOrEqual(0);
          await midi.noteOff(50);
          await midi.noteOff(54);
        });
      }
    });
  }

  test('under reduced motion the held key is shorter at once, with no transition, and nothing lingers', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const midi = await twinkle(page, RIGHT);
    await midi.waitForStep();
    const transition = await page.evaluate(
      () =>
        getComputedStyle(document.querySelector('.keyboard g.key[data-midi="60"]')!)
          .transitionDuration,
    );
    expect(
      transition.split(',').every((d) => parseFloat(d) === 0),
      transition,
    ).toBe(true);
    const pressed = await page.evaluate(async () => {
      const w = window as unknown as { __fakeMidi: { send(bytes: number[]): void } };
      const key = document.querySelector('.keyboard g.key[data-midi="50"]')!;
      w.__fakeMidi.send([0x90, 50, 100]);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const parsed = /^matrix\(([^)]+)\)$/.exec(getComputedStyle(key).transform);
      const depth = parsed ? Number(parsed[1]!.split(',')[3]) : 1;
      w.__fakeMidi.send([0x80, 50, 0]);
      return depth;
    });
    expect(pressed).toBeCloseTo(0.94, 3);
    const late = await tapFor(page, 60, 1080);
    expect(late.level).toBe(false);
    await expectOneRed(page, 'reduced motion, keys down');
    await expectNoSeriousA11y(page, 'reduced motion, keys down');
  });
});

/** How long `staysAt` waits. */
const STAY_MS = 700;

/**
 * Waits a moment and checks that the walk is still on `index`: a key that does not count (the
 * wrong one, one held through a move, a key without its partner) leaves the red where it is
 * however long it is held.
 */
async function staysAt(
  page: Page,
  midi: ReturnType<typeof fakeMidi>,
  index: number,
  message = 'the red moved on',
): Promise<void> {
  await page.waitForTimeout(STAY_MS);
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
