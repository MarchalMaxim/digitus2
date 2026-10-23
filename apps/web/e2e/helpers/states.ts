import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page } from '@playwright/test';
import { mockService, RECOGNITION_WITH_ERRORS } from './scan.js';
import { fakeMidi, installFakeMidi, type FakeMidiOptions } from './midi.js';
import { embellishDecided, openPractice, setLoopBars } from './practice.js';
import { seekBar } from './seek.js';
import { holdPianoSamples } from './samples.js';
import {
  arrivalRows,
  libraryReady,
  searchRows,
  shelfButton,
  showMoreButton,
  tierPill,
} from './library.js';

/**
 * The application states the design brief is checked in (M4 plan, Task 10): each a name, a way
 * to reach it from a fresh page, and the kind of element that must be the screen's one red.
 * Used by `states.spec.ts` (one red, axe, no horizontal overflow, desktop and mobile).
 */
export interface AppState {
  name: string;
  go: (page: Page) => Promise<void>;
  /**
   * 'button': a single red button. 'cursor': the playback cursor's note groups in the sheet.
   * 'frame': the drop frame while a file is dragged. 'note': one selected note in the sheet.
   */
  expectTag: 'button' | 'cursor' | 'frame' | 'note';
  /**
   * Skipped by the mobile (touch) project: the scan review is checked at a phone's width as a
   * narrow window in scan-edit.spec.ts, and a touch phone's scan in scan-phone.spec.ts.
   */
  pcOnly?: boolean;
}

const TWINKLE = 'twinkle-twinkle-little-star';
const TWINKLE_NOTES = 64;
/** Twinkle with "Add notes between" on: six upper neighbours added. */
const TWINKLE_EMBELLISHED_NOTES = 70;
const ARABESQUE = 'burgmuller-op100-no2-arabesque';
const ARABESQUE_EDITORIAL_DIGITS = 26;
/** Schumann's Melody: the engine's reader warns about two duplicate notes. */
const MELODY = 'schumann-op68-no1-melody';
const SCORE_TIMEOUT = 20_000;
/** Seven Easy pieces, the first two also on Easy's Songs shelf (issue #78). */
const FAVOURITES = [
  'mary-had-a-little-lamb',
  'au-clair-de-la-lune',
  'brahms-lullaby',
  TWINKLE,
  'bach-minuet-g-major-bwv-anh-114',
  'mozart-minuet-f-major-k2',
  'ode-to-joy',
];
/** The library's Twinkle as a two-track MIDI file (M6), dropped through the file chooser. */
const TWINKLE_MIDI = fileURLToPath(new URL('../../fixtures/twinkle.mid', import.meta.url));

/**
 * The library's rows: the buttons in the list's items. Not every button named "Open …": the end
 * line's file input is a button too, named "Open your own score".
 */
export function pieceRows(page: Page): Locator {
  return page.getByRole('listitem').getByRole('button', { name: /^Open / });
}

/**
 * The drop frame is on screen and its 120 ms fade is over. While it fades in from opacity 0 the
 * frame is not yet a red root (the red rule skips opacity 0), so the red is counted after it.
 */
export async function dropFrameShown(page: Page): Promise<void> {
  const frame = page.locator('.drop-frame');
  await expect(frame).toBeVisible();
  await frame.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
}

async function library(page: Page): Promise<void> {
  await page.goto('/');
  await libraryReady(page);
  await expect(pieceRows(page)).toHaveCount(arrivalRows('easy'));
}

/**
 * Twinkle with every note fingered; `query` adds e.g. `?audio=silent` before the hash. Also waits
 * until "Add notes between" is offered, so the Practice panel has its last row (the tick box) and
 * no longer grows while a state is checked.
 */
async function twinkleReady(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}#/piece/${TWINKLE}`);
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(TWINKLE_NOTES, {
    timeout: SCORE_TIMEOUT,
  });
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled();
  await embellishDecided(page, 'offered');
}

/**
 * The library with a piano already allowed (issue 182): the setting stored and the browser's
 * permission granted, so the page connects with no press, as on a later visit.
 */
async function libraryWithPiano(page: Page, fake: FakeMidiOptions): Promise<void> {
  await installFakeMidi(page, { permission: 'granted', playAlong: true, ...fake });
  await page.goto('/');
  await libraryReady(page);
  await expect(pieceRows(page)).toHaveCount(arrivalRows('easy'));
}

/** Twinkle waiting for a connected piano: the first group red, its step named by the walk. */
async function twinkleAlong(page: Page): Promise<ReturnType<typeof fakeMidi>> {
  await installFakeMidi(page, { permission: 'granted', playAlong: true });
  await twinkleReady(page, '?audio=silent');
  const midi = fakeMidi(page);
  await midi.waitForStep();
  return midi;
}

/** The engine's digits as printed, in document order (to see a re-solve land). */
function digits(page: Page): Promise<string> {
  return page
    .locator('.score-sheet g.fing')
    .evaluateAll((els) => els.map((e) => e.textContent?.trim() ?? '').join(','));
}

async function playing(page: Page): Promise<void> {
  await twinkleReady(page, '?audio=silent');
  // The count-in holds the first red note back (playback.spec covers it); play through.
  await openPractice(page);
  await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('.score-sheet .is-red').first()).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(800);
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
}

/** Twinkle's third note (G4 over C3, 1.2 s, tick 20160): the paused state's fixed point. */
const PAUSE_SEC = 1.2;
const PAUSE_TICK = '20160';

/**
 * Twinkle paused on its third note, at the same point on every run (Task 5 review): the cursor
 * is watched on every frame until it marks that note, and the next onset is 0.6 s later, ample
 * time for the click. The marked group, the pressed keys and the dock are then the same each
 * time, which a screenshot baseline needs.
 */
async function pausedOnThirdNote(page: Page): Promise<void> {
  await twinkleReady(page, '?audio=silent');
  await openPractice(page);
  await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
  await page.getByRole('button', { name: 'Play' }).click();
  await page.waitForFunction(
    (sec) => {
      const hook = (window as unknown as { __digitus2?: { cursorSec(): number } }).__digitus2;
      return hook !== undefined && Math.abs(hook.cursorSec() - sec) < 1e-6;
    },
    PAUSE_SEC,
    { polling: 'raf', timeout: 10_000 },
  );
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await expect(page.locator('.score-sheet .is-red').first()).toHaveAttribute(
    'data-onset-tick',
    PAUSE_TICK,
  );
  await expect(page.locator('.keyboard .is-pressed').first()).toBeVisible();
}

export const STATES: AppState[] = [
  { name: 'library', go: library, expectTag: 'button' },
  {
    name: 'library-notice',
    go: async (page) => {
      await library(page);
      await page
        .getByLabel('Open your own score')
        .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
      await expect(
        page.getByText(
          'That does not look like a MusicXML or MIDI file (.musicxml, .xml, .mxl, .mid or .midi).',
        ),
      ).toBeVisible();
    },
    expectTag: 'button',
  },
  {
    name: 'library-level',
    go: async (page) => {
      await library(page);
      // Medium, the biggest level: its arrival page is still at most 30 rows.
      await tierPill(page, 'medium').check();
      await expect(pieceRows(page)).toHaveCount(arrivalRows('medium'));
    },
    expectTag: 'button',
  },
  {
    // A shelf opened in place (shelves spec 4.2): the back button, the length pills and a first page.
    name: 'library-shelf',
    go: async (page) => {
      await library(page);
      await tierPill(page, 'medium').check();
      await shelfButton(page, 'songs').click();
      await expect(page.getByRole('button', { name: 'All styles' })).toBeVisible();
      await expect(page.getByRole('group', { name: 'Length' })).toBeVisible();
      await expect(pieceRows(page)).toHaveCount(40);
      await expect(showMoreButton(page)).toBeVisible();
    },
    expectTag: 'button',
  },
  {
    name: 'library-returning',
    go: async (page) => {
      await page.addInitScript(() =>
        localStorage.setItem(
          'digitus2.settings.v1',
          JSON.stringify({
            state: { settings: { lastPlayed: 'bach-minuet-g-major-bwv-anh-114' } },
            version: 1,
          }),
        ),
      );
      await page.goto('/');
      await expect(
        page.getByRole('button', { name: 'Continue with Minuet in G major' }),
      ).toBeVisible();
      await expect(page.getByRole('radio', { name: 'Easy', exact: true })).toBeChecked();
    },
    expectTag: 'button',
  },
  {
    // Seven favourites (issue #78), all of them shown: the shelf above the levels, and favourites
    // that are also Easy's samples, whose rows must not repeat an id.
    name: 'library-favourites',
    go: async (page) => {
      await page.addInitScript(
        (favourites) =>
          localStorage.setItem(
            'digitus2.settings.v1',
            JSON.stringify({ state: { settings: { favourites } }, version: 2 }),
          ),
        FAVOURITES,
      );
      await page.goto('/');
      await libraryReady(page);
      const shelf = page.getByRole('region', { name: 'Favourites' });
      await shelf.getByRole('button', { name: 'All 7 favourites' }).click();
      await expect(shelf.getByRole('button', { name: /^Open / })).toHaveCount(7);
      // axe reports no duplicate id as serious, so the rows' ids are checked here.
      const ids = await page.evaluate(() =>
        [...document.querySelectorAll('[id]')].map((e) => e.id),
      );
      expect(new Set(ids).size).toBe(ids.length);
    },
    expectTag: 'button',
  },
  {
    name: 'library-search',
    go: async (page) => {
      await library(page);
      await page.getByRole('searchbox', { name: 'Search the library' }).fill('minuet');
      await expect(pieceRows(page)).toHaveCount(searchRows('minuet'));
    },
    expectTag: 'button',
  },
  {
    name: 'library-empty',
    go: async (page) => {
      await library(page);
      await page.getByRole('searchbox', { name: 'Search the library' }).fill('fur elize');
      await expect(page.getByText('No piece matches “fur elize”.')).toBeVisible();
    },
    expectTag: 'button',
  },
  {
    name: 'library-drag',
    go: async (page) => {
      await library(page);
      const dt = await page.evaluateHandle(() => {
        const d = new DataTransfer();
        d.items.add(new File(['<score-partwise/>'], 'song.musicxml'));
        return d;
      });
      await page.dispatchEvent('main', 'dragenter', { dataTransfer: dt });
      await dropFrameShown(page);
      await expect(page.getByRole('button', { name: /^Start with/ })).toBeHidden();
    },
    expectTag: 'frame',
  },
  {
    // The home line with a piano connected (issue 182): the sentence and Turn off; the start
    // button stays the one red element.
    name: 'library-piano',
    go: async (page) => {
      await libraryWithPiano(page, {});
      await expect(page.locator('.piano-line [role="status"]')).toHaveText(
        'GO:PIANO MIDI 1 is connected. Open a piece and play the red note.',
      );
      await expect(page.locator('.piano-line button')).toHaveText('Turn off');
    },
    expectTag: 'button',
  },
  {
    // No piano on Windows: the help and the Windows flag, the longest copy of the line at 360 px.
    name: 'library-piano-none',
    go: async (page) => {
      await libraryWithPiano(page, { inputs: [], platform: 'Windows' });
      await expect(page.locator('.piano-line [role="status"]')).toHaveText(
        'No piano found. Connect it with a USB cable, or pair it over Bluetooth and turn it on. ' +
          'On Windows, a Bluetooth piano also needs chrome://flags/#use-winrt-midi-api set to Enabled.',
      );
      await expect(page.locator('.piano-line button')).toHaveText('Turn off');
    },
    expectTag: 'button',
  },
  {
    name: 'about',
    go: async (page) => {
      await page.goto('/#/about');
      await expect(page.getByRole('heading', { level: 1, name: 'About digitus2' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Back to the library' })).toBeVisible();
    },
    expectTag: 'button',
  },
  { name: 'score-ready', go: (page) => twinkleReady(page), expectTag: 'button' },
  {
    name: 'score-small-hand',
    go: async (page) => {
      await twinkleReady(page);
      const before = await digits(page);
      const timing = page.getByText(/Fingered in \d+ ms/);
      const timingBefore = await timing.textContent();
      await page.getByLabel('Hand size').selectOption('child');
      await expect(page.getByLabel('Hand size')).toHaveValue('child');
      // The re-solve has landed when the digits or the timing line change; Twinkle is short, so
      // either happens within a few frames of the worker's answer.
      await expect
        .poll(
          async () =>
            (await digits(page)) !== before || (await timing.textContent()) !== timingBefore,
          {
            timeout: 5_000,
          },
        )
        .toBe(true);
      await expect(page.locator('.score-sheet g.fing')).toHaveCount(TWINKLE_NOTES);
    },
    expectTag: 'button',
  },
  {
    name: 'score-editorial',
    go: async (page) => {
      await page.goto(`/#/piece/${ARABESQUE}`);
      await expect(page.locator('.score-sheet svg').first()).toBeVisible({
        timeout: SCORE_TIMEOUT,
      });
      await page.getByLabel("Show the editor's fingering").check();
      await expect(page.locator('.score-sheet g.fing')).toHaveCount(ARABESQUE_EDITORIAL_DIGITS, {
        timeout: SCORE_TIMEOUT,
      });
      // The line above the score says whose digits these are (polish plan, Task 5).
      await expect(page.getByText("Showing the editor's fingering", { exact: true })).toBeVisible();
    },
    expectTag: 'button',
  },
  {
    // The side panel's Details open: the solve and layout timings and the reader's warnings,
    // hidden by default (polish plan, Task 5). Melody has two warnings, long lines at 360 px.
    name: 'score-details',
    go: async (page) => {
      await page.goto(`/#/piece/${MELODY}`);
      await expect(page.locator('.score-sheet svg').first()).toBeVisible({
        timeout: SCORE_TIMEOUT,
      });
      const details = page.locator('.side-panel details');
      await details.locator('summary').click();
      await expect(details).toHaveAttribute('open', '');
      await expect(page.getByText(/^Fingered in \d+ ms · laid out in \d+ ms$/)).toBeVisible();
      await expect(details.getByText(/^note \d+: duplicate of note \d+/)).toHaveCount(2);
    },
    expectTag: 'button',
  },
  {
    // The first Play with the real instrument, its samples held back: Play stays red and busy,
    // and the status line in the dock says what is happening (polish plan, Task 3).
    name: 'score-loading-piano',
    go: async (page) => {
      await holdPianoSamples(page);
      await twinkleReady(page);
      await page.getByRole('button', { name: 'Play' }).click();
      await expect(page.getByRole('status')).toHaveText('Loading the piano…');
      await expect(page.getByRole('button', { name: 'Play' })).toHaveAttribute('aria-busy', 'true');
    },
    expectTag: 'button',
  },
  {
    // The count-in: Pause is the red element and the status line counts; no note is red until
    // the first one sounds (polish plan, Task 3). At 50 % Twinkle counts four beats of 1.2 s,
    // which leaves the checks time to run inside the count-in.
    name: 'score-count-in',
    go: async (page) => {
      await twinkleReady(page, '?audio=silent');
      await openPractice(page);
      await expect(page.getByRole('checkbox', { name: 'Count-in' })).toBeChecked();
      await page.getByRole('slider', { name: 'Tempo' }).fill('50');
      await page.getByRole('button', { name: 'Play' }).click();
      await expect(page.getByRole('status')).toHaveText('1');
      await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
      await expect(page.locator('.score-sheet .is-red')).toHaveCount(0);
    },
    expectTag: 'button',
  },
  { name: 'score-playing', go: playing, expectTag: 'cursor' },
  {
    // T10 (spec 14): paused after a note was heard, the last group heard keeps the red and its
    // keys stay pressed; Play is plain.
    name: 'score-paused',
    go: pausedOnThirdNote,
    expectTag: 'cursor',
  },
  {
    // Rewind while paused: nothing to resume, the marks and the keys clear and Play is red.
    name: 'score-rewound',
    go: async (page) => {
      await pausedOnThirdNote(page);
      await page.getByRole('button', { name: 'Rewind' }).click();
      await expect(page.locator('.score-sheet .is-red')).toHaveCount(0);
      // Rewind's red returns via the motion flight; this state checks its settled destination.
      await expect(page.locator('.red-ghost')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Play' })).toHaveClass(/is-red/);
    },
    expectTag: 'button',
  },
  {
    // T13: a click on a bar while stopped cues it; its first note takes the red once the hop lands.
    name: 'score-cued',
    go: async (page) => {
      await twinkleReady(page, '?audio=silent');
      await seekBar(page, 2);
      await expect(page.locator('.red-ghost')).toHaveCount(0);
      await expect(page.locator('.score-sheet .is-red').first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Play' })).not.toHaveClass(/is-red/);
    },
    expectTag: 'cursor',
  },
  {
    // A piano waiting (issue 182): the first group red, Play plain, the hint in the dock, and
    // the reader's C4 held on the piano: that key shows the cue's fill and finger plus the bar.
    name: 'score-along',
    go: async (page) => {
      const midi = await twinkleAlong(page);
      await expect(page.getByRole('status')).toHaveText('Play the red notes on your piano.');
      await midi.noteOn(60); // half of the first step [48, 60]
      await expect(page.locator('.keyboard .key[data-midi="60"] .key-held')).toHaveCount(1);
      await expect(page.locator('.keyboard .key[data-midi="60"]')).toHaveClass(/is-pressed/);
      await expect(page.getByRole('button', { name: 'Play' })).not.toHaveClass(/is-red/);
    },
    expectTag: 'cursor',
  },
  {
    // Two steps played and one key held: the red waits on the third step [67], the held E4 is
    // in no step, so it stays held.
    name: 'score-along-moved',
    go: async (page) => {
      const midi = await twinkleAlong(page);
      await midi.playRed();
      await midi.playRed();
      expect(await midi.waitForStep()).toEqual([67]);
      await midi.noteOn(64);
      await expect(page.locator('.keyboard .key[data-midi="64"] .key-held')).toHaveCount(1);
      await expect(page.getByRole('status')).toHaveText('');
      await expect(page.getByRole('button', { name: 'Play' })).not.toHaveClass(/is-red/);
    },
    expectTag: 'cursor',
  },
  {
    name: 'score-loop',
    go: async (page) => {
      await twinkleReady(page);
      await setLoopBars(page, '2', '3');
      await expect(page.getByRole('checkbox', { name: 'Loop bars' })).toBeChecked();
    },
    expectTag: 'button',
  },
  {
    name: 'score-practice-open',
    go: async (page) => {
      await twinkleReady(page);
      await openPractice(page);
      await expect(page.getByRole('slider', { name: 'Tempo' })).toBeVisible();
    },
    expectTag: 'button',
  },
  {
    // "Add notes between" (issue #67) ticked: the embellished score with its own digits.
    name: 'score-embellished',
    go: async (page) => {
      await twinkleReady(page);
      await openPractice(page);
      await page.getByRole('checkbox', { name: 'Add notes between' }).check();
      await expect(page.locator('.score-sheet g.fing')).toHaveCount(TWINKLE_EMBELLISHED_NOTES, {
        timeout: SCORE_TIMEOUT,
      });
    },
    expectTag: 'button',
  },
  {
    name: 'score-error',
    go: async (page) => {
      await library(page);
      await page.getByLabel('Open your own score').setInputFiles({
        name: 'bad.musicxml',
        mimeType: 'application/xml',
        buffer: Buffer.from('<nope/>'),
      });
      await expect(page.getByRole('alert')).toContainText(/could not open/i);
      await expect(page.getByRole('button', { name: 'Back to the library' })).toBeVisible();
    },
    expectTag: 'button',
  },
  {
    name: 'score-midi',
    go: async (page) => {
      await page.goto('/');
      await page.getByLabel('Open your own score').setInputFiles(TWINKLE_MIDI);
      await expect(page.locator('.score-sheet g.fing')).toHaveCount(TWINKLE_NOTES, {
        timeout: SCORE_TIMEOUT,
      });
    },
    expectTag: 'button',
  },
  {
    name: 'scan-import',
    go: async (page) => {
      await mockService(page, '');
      await scanSource(page);
      // Scan this score is the red, on a PC and on a phone alike.
      await expect(page.locator('.scan-intro .is-red')).toBeVisible();
    },
    expectTag: 'button',
  },
  {
    name: 'scan-review',
    go: async (page) => {
      await scanReview(page, readFileSync(TWINKLE_XML, 'utf8'));
      await expect(page.getByRole('button', { name: 'Use for fingerings' })).toBeEnabled();
    },
    expectTag: 'button',
    pcOnly: true,
  },
  {
    name: 'scan-note-selected',
    go: async (page) => {
      await scanReview(page, readFileSync(TWINKLE_XML, 'utf8'));
      await expect(page.locator('.scan-sheet')).toHaveAttribute('aria-busy', 'false');
      await page.locator('.scan-sheet [id="s2"]').click({ force: true });
      await expect(page.getByRole('region', { name: 'Correct the selected note' })).toBeVisible();
    },
    expectTag: 'note',
    pcOnly: true,
  },
  {
    name: 'scan-refused',
    go: async (page) => {
      await scanReview(page, RECOGNITION_WITH_ERRORS);
      await expect(page.getByRole('button', { name: 'Use for fingerings' })).toBeDisabled();
      await expect(page.locator('details.scan-problems')).toHaveAttribute('open', '');
    },
    expectTag: 'button',
    pcOnly: true,
  },
];

/** The rendered Twinkle page (CC0, from the library) and its MusicXML, standing in for a scan. */
const TWINKLE_PAGE = fileURLToPath(new URL('../../fixtures/twinkle-page.png', import.meta.url));
const TWINKLE_XML = fileURLToPath(
  new URL('../../../../content/scores/twinkle-twinkle-little-star.musicxml', import.meta.url),
);

/** The scan page with the Twinkle page chosen, before Scan is pressed. */
async function scanSource(page: Page): Promise<void> {
  await library(page);
  await page.getByLabel('Open your own score').setInputFiles(TWINKLE_PAGE);
  await expect(page.getByRole('heading', { name: 'From paper to piano' })).toBeVisible();
  await expect(page.locator('.scan-original-image')).toHaveJSProperty('complete', true);
}

/** The review of `xml` as the (mocked) scan service's recognition of the Twinkle page. */
async function scanReview(page: Page, xml: string): Promise<void> {
  await mockService(page, xml);
  await scanSource(page);
  await page.getByRole('button', { name: 'Scan this score' }).click();
  await expect(page.getByRole('heading', { name: 'Review the recognition' })).toBeVisible();
  await expect(page.locator('.scan-sheet svg').first()).toBeVisible();
}
