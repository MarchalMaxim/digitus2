import { expect, test, type Page } from '@playwright/test';
import { fakeMidi, installFakeMidi } from './helpers/midi.js';
import { expectOneRed } from './helpers/red.js';

// A piano the browser lists and cannot hear (issue 252). Chrome on Windows keeps a Bluetooth
// piano's WinRT port for the life of the browser process; after the piano is turned off and on
// the port stays listed, `connected` and `open`, and receives nothing, through every new
// `requestMIDIAccess` and every reload, until a new browser process opens it again (measured on
// the owner's GO:PIANO: 61 opens and 39 reopens in one session heard no note). The fake's `deaf`
// is that failure, and `wake` is the new browser process. The app can cure none of it from the
// page, so it must never say the piano is connected while it hears nothing, and it names the cure.

const MINUET = 'bach-minuet-g-major-bwv-anh-114';
const PORT = 'GO:PIANO MIDI 1 (Bluetooth MIDI IN)';
const CURE_SCORE =
  'Your piano is not heard yet. If the red note does not move when you play it, turn the piano on, then close every Chrome window and open Chrome again.';
const CURE_HOME =
  'GO:PIANO MIDI 1 is found but not heard yet. Press a key on it. If nothing changes, turn the piano on, then close every Chrome window and open Chrome again.';
const CONNECTED = 'GO:PIANO MIDI 1 is connected. Open a piece and play the red note.';

test.use({ viewport: { width: 1280, height: 900 } });

const dockStatus = (page: Page) => page.locator('.score-status');
const heldKeys = (page: Page) => page.locator('.keyboard .key-held');

test('a listed piano that cannot be heard is never called connected, and the line names the cure', async ({
  page,
}) => {
  // A later visit straight to a score's address, as the owner opened a link: the permission is
  // granted and the setting on, so the page connects with no press.
  await installFakeMidi(page, {
    permission: 'granted',
    playAlong: true,
    platform: 'Windows',
    inputs: [PORT],
    deaf: true,
  });
  await page.goto(`/?audio=silent#/piece/${MINUET}`);
  const midi = fakeMidi(page);
  const first = await midi.waitForStep();
  await expect(dockStatus(page)).toHaveText(CURE_SCORE);
  await expectOneRed(page, 'the piano is listed and not heard');

  // The reader plays the red note: nothing reaches the page, so nothing moves, no key turns gray,
  // and the line keeps saying the piano is not heard.
  for (const pitch of first) await midi.noteOn(pitch);
  await page.waitForTimeout(500);
  expect(await midi.index()).toBe(0);
  await expect(heldKeys(page)).toHaveCount(0);
  await expect(dockStatus(page)).toHaveText(CURE_SCORE);
  for (const pitch of first) await midi.noteOff(pitch);

  // Nothing the page does in the background helps, so it does nothing: no reopen loop.
  await page.waitForTimeout(12_000);
  expect(await midi.requests()).toBe(1);
  await expect(dockStatus(page)).toHaveText(CURE_SCORE);

  // A reload changes nothing either: the browser keeps the dead port.
  await page.reload();
  await midi.waitForStep();
  await expect(dockStatus(page)).toHaveText(CURE_SCORE);
  for (const pitch of first) await midi.noteOn(pitch);
  await page.waitForTimeout(300);
  expect(await midi.index()).toBe(0);
  for (const pitch of first) await midi.noteOff(pitch);

  // The home line says the same: found, not heard, and the cure; never connected.
  await page.goto('/');
  await expect(page.locator('.piano-line [role="status"]')).toHaveText(CURE_HOME);
  await expect(page.locator('.piano-line button')).toHaveText('Turn off');

  // The cure: a new browser process hears the piano. The first key proves it, and the line says
  // connected only then.
  await page.evaluate(() =>
    (window as unknown as { __fakeMidi: { wake(): void } }).__fakeMidi.wake(),
  );
  await expect(page.locator('.piano-line [role="status"]')).toHaveText(CURE_HOME);
  await midi.noteOn(60);
  await expect(page.locator('.piano-line [role="status"]')).toHaveText(CONNECTED);
  await midi.noteOff(60);

  // And in the score, the red moves at the press and the keys show it.
  await page.goto(`/?audio=silent#/piece/${MINUET}`);
  const step = await midi.waitForStep();
  await expect(dockStatus(page)).toHaveText(CURE_SCORE);
  for (const pitch of step) await midi.noteOn(pitch);
  await expect.poll(() => midi.index()).toBe(1);
  await expect(heldKeys(page)).toHaveCount(step.length);
  await expect(dockStatus(page)).toHaveText('');
  await expectOneRed(page, 'heard, the red moved');

  // The black box tells what happened: one open per page, the first note only once heard.
  const log = await page.evaluate(() =>
    (JSON.parse(localStorage.getItem('digitus2.midi.log') ?? '[]') as { event: string }[]).map(
      (e) => e.event,
    ),
  );
  expect(log.filter((e) => e === 'reconnect')).toEqual([]);
  expect(log.filter((e) => e === 'first note').length).toBe(2);
});
