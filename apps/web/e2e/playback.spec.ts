import { expect, test, type Page } from '@playwright/test';
import { expectNoSeriousA11y } from './helpers/axe.js';
import { closePractice, embellishDecided, openPractice, setLoopBars } from './helpers/practice.js';
import { accentAreas, type AccentArea, type Box } from './helpers/pixels.js';
import { expectOneRed } from './helpers/red.js';
import { delayPianoSamples, PIANO_SAMPLES } from './helpers/samples.js';
import { libraryReady, openLibraryPiece, showPiece } from './helpers/library.js';
import { horizontalOverflow } from './helpers/overflow.js';
import { redBars, redSettled, seekBar } from './helpers/seek.js';

/** What the status line says while the first Play of a score loads the piano's samples. */
const LOADING_THE_PIANO = 'Loading the piano…';

/** Happy Birthday (the first level 2 piece): a one-beat pickup in the right hand alone, in 3/4. */
const HAPPY_BIRTHDAY = 'happy-birthday';
const HAPPY_BIRTHDAY_DIGITS = 43;

/** The hook the app installs with `?audio=silent` (useCursor.ts). */
interface TestHook {
  positionSec(): number;
  cursorSec(): number;
  groupSecs(): number[];
}

function position(page: Page): Promise<number> {
  return page.evaluate(() =>
    (window as unknown as { __digitus2: TestHook }).__digitus2.positionSec(),
  );
}

/** A one-staff melody (the engine gives it to the right hand): two bars of quarter notes. */
function melodyXml(): string {
  const note = (step: string, octave: number) =>
    `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch>` +
    '<duration>1</duration><type>quarter</type></note>';
  const attributes =
    '<attributes><divisions>1</divisions><key><fifths>0</fifths></key>' +
    '<time><beats>4</beats><beat-type>4</beat-type></time>' +
    '<clef><sign>G</sign><line>2</line></clef></attributes>';
  const bar1 = ['C', 'D', 'E', 'F'].map((s) => note(s, 4)).join('');
  const bar2 = ['G', 'A', 'B'].map((s) => note(s, 4)).join('') + note('C', 5);
  return (
    '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0">' +
    '<part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>' +
    `<part id="P1"><measure number="1">${attributes}${bar1}</measure>` +
    `<measure number="2">${bar2}</measure></part></score-partwise>`
  );
}

/**
 * Loops K.545 from bar 10, so the cursor scrolls the page deep into the score, and checks that
 * Pause stays in the dock inside the viewport and that Space pauses and plays without scrolling.
 */
async function expectDockKeepsPause(page: Page): Promise<void> {
  await page.goto('/?audio=silent#/piece/mozart-sonata-k545-mvt1');
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(1288, { timeout: 20_000 });
  await openPractice(page);
  await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
  // A loop from bar 10 starts playback there: the cursor scrolls the page down to it.
  await setLoopBars(page, '10', '11');
  // Practice set, the panel closes: open, it is half a phone's window, and the cursor would then
  // scroll the page at every system while the checks below wait for it to settle.
  await closePractice(page);
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('.score-sheet .is-red').first()).toBeInViewport({ timeout: 5_000 });
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  // Pause is in the dock, inside the viewport, while the cursor is deep in the score.
  const pause = page.getByRole('button', { name: 'Pause' });
  const box = (await pause.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  await expect(page.locator('.dock').getByRole('button', { name: 'Pause' })).toHaveCount(1);
  await expectOneRed(page, 'playing bar 10');

  // Space pauses and plays while no control has the focus (the click left it on Pause).
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(page.locator('body')).toBeFocused();
  // Let the cursor's own scroll finish, so a page scroll after Space could only come from Space.
  let settled = -1;
  await expect
    .poll(async () => {
      const y = await page.evaluate(() => window.scrollY);
      const same = y === settled;
      settled = y;
      return same;
    })
    .toBe(true);
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  // T10: the pause keeps the last group heard red, and Play plain.
  const paused = await expectOneRed(page, 'paused with Space');
  expect(paused.every((r) => r.inSheet)).toBe(true);
  await expect(page.getByRole('button', { name: 'Play' })).not.toHaveClass(/is-red/);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.scrollY)).toBe(settled); // Space did not scroll
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(page.locator('.score-sheet .is-red').first()).toBeVisible();
  const again = await expectOneRed(page, 'playing again with Space');
  expect(again.every((r) => r.inSheet)).toBe(true);
  await expect(page.locator('body')).toBeFocused();
}

/** A red note left outside the band between the top of the window and the dock. */
interface OutsideBand {
  tick: string | null;
  top: number;
  bottom: number;
  dockTop: number;
  scrollY: number;
}

/**
 * How many frames in a row a red note may stay outside the band on a page that has not moved:
 * the cursor asks for its scroll with the notes that need it, but a smooth scroll leaves the
 * page where it is for a few frames before it moves (Chromium's ease-in). Measured with the CPU
 * throttled 3 times, the case CI met at 29 frames a second: three frames (60 to 100 ms), then the
 * page moves. A cursor left behind stays outside until it leaves the band itself, for many more.
 */
const LEFT_BEHIND_FRAMES = 5;

/**
 * Samples animation frames for at least `minimumMs`, extending up to 45 s until more than 200
 * steady frames cover four checked systems. A frame is steady when the dock is stuck to the
 * bottom of the window, the page has not scrolled for three frames and the cursor has marked the
 * same notes for three frames. A red note is left behind when it stays outside the band, with
 * the dock stuck and the page not moving, for more than `LEFT_BEHIND_FRAMES` frames in a row: a
 * count of frames, not a time, because the scroll's start-up is counted in frames and frames slow
 * down with the machine. Returns the steady frames, how far the cursor went (onset groups and
 * systems) and each time a red note was left behind.
 */
function sampleCursorAgainstDock(
  page: Page,
  minimumMs: number,
): Promise<{
  frames: number;
  groups: number;
  systems: number;
  checkedSystems: number;
  elapsedMs: number;
  outside: OutsideBand[];
}> {
  return page.evaluate(
    async ({ minimumDuration, leftBehindFrames }) => {
      const outside: OutsideBand[] = [];
      const groups = new Set<string | null>();
      const systems = new Set<Element>();
      const checkedSystems = new Set<Element>();
      let frames = 0;
      let lastY = window.scrollY;
      let lastTick: string | null = null;
      let still = 0;
      let same = 0;
      let run = 0; // frames in a row with a red note outside the band on a page not moving
      const start = performance.now();
      const deadline = start + 45_000;
      await new Promise<void>((resolve) => {
        const frame = () => {
          const now = performance.now();
          if (
            now >= deadline ||
            (now - start >= minimumDuration && frames > 200 && checkedSystems.size >= 4)
          ) {
            resolve();
            return;
          }
          const reds = [...document.querySelectorAll('.score-sheet .is-red')];
          still = window.scrollY === lastY ? still + 1 : 0;
          lastY = window.scrollY;
          const tick = reds[0]?.getAttribute('data-onset-tick') ?? null;
          same = tick === lastTick ? same + 1 : 0;
          lastTick = tick;
          const dock = document.querySelector('.dock')!.getBoundingClientRect();
          const stuck = Math.abs(dock.bottom - window.innerHeight) < 1;
          if (reds.length > 0) {
            groups.add(tick);
            const system = reds[0]!.closest('g.system');
            if (system) systems.add(system);
            if (stuck && still >= 3 && same >= 2) {
              frames++;
              if (system) checkedSystems.add(system);
            }
          }
          let out = false;
          if (reds.length > 0 && stuck && still >= 1) {
            const rects = reds.map((r) => r.getBoundingClientRect());
            const top = Math.min(...rects.map((r) => r.top));
            const bottom = Math.max(...rects.map((r) => r.bottom));
            out = top < -0.5 || bottom > dock.top + 0.5;
            if (out && run === leftBehindFrames)
              outside.push({ tick, top, bottom, dockTop: dock.top, scrollY: window.scrollY });
          }
          run = out ? run + 1 : 0;
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      return {
        frames,
        groups: groups.size,
        systems: systems.size,
        checkedSystems: checkedSystems.size,
        elapsedMs: performance.now() - start,
        outside,
      };
    },
    { minimumDuration: minimumMs, leftBehindFrames: LEFT_BEHIND_FRAMES },
  );
}

/** One animation frame of the score view, as `sampleUntilFirstRedNote` records it. */
interface PlayFrame {
  /** `performance.now()` at the frame. */
  t: number;
  /** The status line's text ('' while it says nothing; null if it were missing from the dock). */
  status: string | null;
  /** Whether the status line sits in the dock. */
  statusInDock: boolean;
  /** The dock's play button: its label, and whether it carries the red class. */
  button: string | null;
  buttonRed: boolean;
  /** Whether the red is on its way between the button and the cursor (RedFlight.tsx). */
  ghostRed: boolean;
  /** Elements with the red class inside the sheet (the cursor), and the first one's onset tick. */
  redNotes: number;
  tick: string | null;
  /** Pressed keys on the on-screen keyboard, and the hand of each. */
  pressed: number;
  pressedHands: string[];
  /** The dimmed keys (the hand left out of one-hand practice), by MIDI number, low to high. */
  dimmed: number[];
  /** The transport clock (score seconds being heard); NaN without the silent run's test hook. */
  position: number;
  /** The `sec` of the group the cursor marks (NaN when it marks none, or without the hook). */
  cursorSec: number;
}

/**
 * Records every animation frame inside the page from now until three frames after the first red
 * note in the sheet (or `ms`), so nothing that lasts a frame between the click on Play and the
 * first note goes unseen. Start it before the click and await it after.
 */
function sampleUntilFirstRedNote(page: Page, ms: number): Promise<PlayFrame[]> {
  return recordFrames(page, ms, true);
}

/** Records every animation frame inside the page for `ms`, as `sampleUntilFirstRedNote` does. */
function sampleFrames(page: Page, ms: number): Promise<PlayFrame[]> {
  return recordFrames(page, ms, false);
}

function recordFrames(page: Page, ms: number, untilFirstRed: boolean): Promise<PlayFrame[]> {
  return page.evaluate(
    ({ duration, stopAtRed }) =>
      new Promise<PlayFrame[]>((resolve) => {
        const frames: PlayFrame[] = [];
        const end = performance.now() + duration;
        let after = -1;
        const frame = () => {
          const status = document.querySelector('[role="status"]');
          const button = document.querySelector('.dock .play-button');
          const reds = document.querySelectorAll('.score-sheet .is-red');
          const hook = (
            window as unknown as { __digitus2?: { positionSec(): number; cursorSec(): number } }
          ).__digitus2;
          frames.push({
            t: performance.now(),
            status: status ? (status.textContent ?? '') : null,
            statusInDock: status?.closest('.dock') != null,
            button: button?.textContent ?? null,
            buttonRed: button?.classList.contains('is-red') ?? false,
            ghostRed: document.querySelector('.red-ghost-shape.is-red') !== null,
            redNotes: reds.length,
            tick: reds[0]?.getAttribute('data-onset-tick') ?? null,
            pressed: document.querySelectorAll('.keyboard .is-pressed').length,
            pressedHands: [...document.querySelectorAll('.keyboard .is-pressed')].map(
              (k) => k.getAttribute('data-hand') ?? '',
            ),
            dimmed: [...document.querySelectorAll('.keyboard .key.is-muted')]
              .map((k) => Number(k.getAttribute('data-midi')))
              .sort((a, b) => a - b),
            position: hook ? hook.positionSec() : Number.NaN,
            cursorSec: hook ? hook.cursorSec() : Number.NaN,
          });
          if (stopAtRed && reds.length > 0 && after < 0) after = 3;
          if (after === 0 || performance.now() > end) {
            resolve(frames);
            return;
          }
          if (after > 0) after--;
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
    { duration: ms, stopAtRed: untilFirstRed },
  );
}

/** The values a run of frames passes through, each once per run (consecutive repeats dropped). */
function runs<T>(values: T[]): T[] {
  return values.filter((v, i) => i === 0 || v !== values[i - 1]);
}

/**
 * Plays K.545 from the start at 150 % for at least 18 s, waiting for more than 200 eligible
 * frames across four checked systems (up to 45 s), and checks that
 * the red cursor is never left under the dock or above the window while the page is still.
 */
async function expectCursorAboveDock(page: Page): Promise<void> {
  test.setTimeout(90_000); // Includes score setup plus the sampler's 45 s hard deadline at either width.
  await page.goto('/?audio=silent#/piece/mozart-sonata-k545-mvt1');
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(1288, { timeout: 20_000 });
  await openPractice(page);
  await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
  await page.getByRole('slider', { name: 'Tempo' }).fill('150');
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('.score-sheet .is-red').first()).toBeVisible({ timeout: 5_000 });
  const seen = await sampleCursorAgainstDock(page, 18_000);
  const coverage = `${seen.frames} steady frames, ${seen.groups} groups, ${seen.systems} observed systems, ${seen.checkedSystems} checked systems in ${Math.round(seen.elapsedMs)} ms`;
  expect(seen.systems, `the cursor crossed several systems: ${coverage}`).toBeGreaterThanOrEqual(4);
  expect(
    seen.checkedSystems,
    `several systems checked against the dock: ${coverage}`,
  ).toBeGreaterThanOrEqual(4);
  expect(seen.frames, `frames counted: ${coverage}`).toBeGreaterThan(200);
  expect(
    seen.outside.length,
    `red notes left outside the band above the dock (${coverage}), first: ` +
      JSON.stringify(seen.outside.slice(0, 3)),
  ).toBe(0);
  await expectOneRed(page, 'playing after the sampling');
}

/** A system the cursor entered while `samplePageTurns` watched (issue #5). */
interface SystemEntry {
  /** The system's top and bottom on the page (viewport plus the scroll offset) at entry. */
  top: number;
  bottom: number;
  /** Whether the system lay wholly in the band between the top of the window and the dock at entry. */
  fit: boolean;
  /** Whether the page was still moving at entry (a turn under way): its fit is not judged. */
  moving: boolean;
  /** How many page turns settled while the cursor was in this system. */
  turns: number;
}

/** A page turn that settled: where the cursor's system then stood below the top of the band. */
interface PageTurn {
  systemTop: number;
  scrollY: number;
}

/** The room a page turn leaves above the system (`SYSTEM_TOP_MARGIN` in useCursor.ts). */
const SYSTEM_TOP_MARGIN = 12;

/**
 * Watches the playing cursor cross systems until it has left `minimumSystems` of them (up to
 * 70 s): for each system, whether it lay wholly in the band above the dock when the cursor
 * entered it and how many page turns settled during its stay; for each turn, where it left the
 * system. A turn settles when the page, having moved, holds still for three frames with the
 * dock stuck to the bottom of the window. Counts of frames and systems, never a time.
 */
function samplePageTurns(
  page: Page,
  minimumSystems: number,
): Promise<{
  band: { top: number; bottom: number };
  entries: SystemEntry[];
  turns: PageTurn[];
  elapsedMs: number;
}> {
  return page.evaluate(async (minimum) => {
    const entries: SystemEntry[] = [];
    const turns: PageTurn[] = [];
    let band = { top: 0, bottom: 0 };
    let system: Element | null = null;
    let lastY = window.scrollY;
    let settledY = window.scrollY;
    let still = 0;
    const start = performance.now();
    const deadline = start + 70_000;
    await new Promise<void>((resolve) => {
      const frame = () => {
        // One system more than asked: the last entry's stay is still under way when sampling ends.
        if (performance.now() >= deadline || entries.length > minimum) {
          resolve();
          return;
        }
        requestAnimationFrame(frame);
        const dock = document.querySelector('.dock')!.getBoundingClientRect();
        if (Math.abs(dock.bottom - window.innerHeight) >= 1) return; // the dock not stuck yet
        band = { top: 0, bottom: dock.top };
        const y = window.scrollY;
        const moving = y !== lastY;
        still = moving ? 0 : still + 1;
        lastY = y;
        const red = document.querySelector('.score-sheet .is-red');
        const current = red?.closest('g.system') ?? null;
        if (current && current !== system) {
          system = current;
          const r = current.getBoundingClientRect();
          entries.push({
            top: r.top + y,
            bottom: r.bottom + y,
            fit: r.top >= band.top && r.bottom <= band.bottom,
            moving,
            turns: 0,
          });
        }
        if (y !== settledY && still >= 3) {
          settledY = y;
          const r = system?.getBoundingClientRect();
          turns.push({ systemTop: r ? r.top - band.top : Number.NaN, scrollY: y });
          const entry = entries[entries.length - 1];
          if (entry) entry.turns++;
        }
      };
      requestAnimationFrame(frame);
    });
    return { band, entries, turns, elapsedMs: performance.now() - start };
  }, minimumSystems);
}

/**
 * How many scrolls the rule before issue #5 would take over the same systems: it centred every
 * system the cursor entered that was not wholly in the band, so each turn showed a fraction of
 * the next system and the next entry scrolled again.
 */
function centringTurns(entries: SystemEntry[], band: { top: number; bottom: number }): number {
  const room = band.bottom - band.top;
  let scrollY = entries[0] ? Math.max(0, entries[0].top - band.top) : 0;
  let turns = 0;
  for (const s of entries) {
    const top = s.top - scrollY;
    const bottom = s.bottom - scrollY;
    if (top >= band.top && bottom <= band.bottom) continue;
    scrollY += top - (band.top + (room - (bottom - top)) / 2);
    turns++;
  }
  return turns;
}

/**
 * Plays K.545 from the start at 150 % until the cursor has left nine systems and checks the
 * page turns of issue #5: the page holds still while the cursor's system is wholly above the
 * dock, turns when the cursor enters the first system that is not (the one after the last
 * system fully visible), each turn leaves that system at the top of the band with the margin
 * for its digits, and the turns are fewer than centring every entered system would take.
 */
async function expectPageTurnsOncePerScreenful(page: Page): Promise<void> {
  test.setTimeout(110_000); // Score setup plus the sampler's 70 s hard deadline.
  await page.goto('/?audio=silent#/piece/mozart-sonata-k545-mvt1');
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(1288, { timeout: 20_000 });
  await openPractice(page);
  await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
  await page.getByRole('slider', { name: 'Tempo' }).fill('150');
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('.score-sheet .is-red').first()).toBeVisible({ timeout: 5_000 });
  const seen = await samplePageTurns(page, 9);
  const trace = JSON.stringify(seen);
  expect(seen.entries.length, `systems entered: ${trace}`).toBeGreaterThan(9);
  // The stays that ended: the last system entered may still be waiting for its turn to settle.
  const stays = seen.entries.slice(0, -1);
  const judged = stays.filter((e) => !e.moving);
  expect(judged.length, `systems entered on a still page: ${trace}`).toBeGreaterThanOrEqual(4);
  // The page holds still while the system is wholly visible, and turns once when it is not.
  for (const e of judged)
    expect(e.turns, `turns in ${JSON.stringify(e)}: ${trace}`).toBe(e.fit ? 0 : 1);
  expect(
    judged.some((e) => e.fit),
    `a system entered wholly in view: ${trace}`,
  ).toBe(true);
  expect(
    judged.some((e) => !e.fit),
    `a system entered under the dock: ${trace}`,
  ).toBe(true);
  // A turn puts the system's top at the margin below the top of the band.
  for (const t of seen.turns) {
    expect(t.systemTop, `a settled turn: ${trace}`).toBeGreaterThanOrEqual(seen.band.top - 1);
    expect(t.systemTop, `a settled turn: ${trace}`).toBeLessThanOrEqual(SYSTEM_TOP_MARGIN + 1);
  }
  // Fewer turns than centring each entered system took: a turn per screenful, not per system.
  const old = centringTurns(stays, seen.band);
  test.info().annotations.push({
    type: 'page turns',
    description: `${seen.turns.length} over ${stays.length} systems, against ${old} by centring`,
  });
  expect(seen.turns.length, `turns against the centring rule's ${old}: ${trace}`).toBeLessThan(old);
  await expectOneRed(page, 'playing after the sampling');
}

/** A note or a digit of the score, with the staff it is on and how it is drawn. */
interface ScoreMark {
  id: string;
  /** The place of its staff in the bar: 0 for the upper staff (the right hand), 1 the lower. */
  staff: number;
  /** Its computed fill opacity: how a note is dimmed, which its shapes inherit (base.css). */
  fillOpacity: string;
  /**
   * What it shows at: its fill opacity times the group opacity of it and its ancestors within the
   * sheet. A note's groups stay opaque (a translucent group of notes costs a compositor layer,
   * issue #79); a dimmed digit at rest is drawn through its own group opacity instead.
   */
  shown: number;
  red: boolean;
}

/** Every note (`g.note`) and digit (`g.fing`, by its note) of the sheet, with its staff. */
function scoreMarks(page: Page): Promise<{ notes: ScoreMark[]; digits: ScoreMark[] }> {
  return page.evaluate(() => {
    const sheet = document.querySelector('.score-sheet')!;
    const staffOf = (note: Element | null) => {
      const staff = note?.closest('g.staff');
      if (!staff) return -1;
      return [...staff.parentElement!.children].filter((s) => s.matches('g.staff')).indexOf(staff);
    };
    const shown = (el: Element) => {
      let o = parseFloat(getComputedStyle(el).fillOpacity);
      for (let e: Element | null = el; e && e !== sheet; e = e.parentElement)
        o *= parseFloat(getComputedStyle(e).opacity);
      return Math.round(o * 1000) / 1000;
    };
    const mark = (el: Element, note: Element | null) => ({
      id: el.id || (el.getAttribute('data-startid') ?? ''),
      staff: staffOf(note),
      fillOpacity: getComputedStyle(el).fillOpacity,
      shown: shown(el),
      red: el.closest('.is-red') !== null,
    });
    const notes = [...sheet.querySelectorAll('g.note')].map((n) => mark(n, n));
    const digits = [...sheet.querySelectorAll('g.fing')].map((f) =>
      mark(f, document.getElementById((f.getAttribute('data-startid') ?? '').slice(1))),
    );
    return { notes, digits };
  });
}

/**
 * With one hand selected, the other hand's notes and digits show at 40 % in the score, the hand
 * played's in full; `left` is whether the left hand is the one played.
 */
async function expectScoreDimmed(page: Page, left: boolean, label: string): Promise<void> {
  const { notes, digits } = await scoreMarks(page);
  const out = left ? 0 : 1; // the staff of the hand left out
  for (const list of [notes, digits]) {
    expect(new Set(list.map((m) => m.staff)), label).toEqual(new Set([0, 1]));
  }
  for (const n of notes) {
    // A note the cursor marks is never pale (it belongs to the hand played).
    expect(n.shown, `${label} ${JSON.stringify(n)}`).toBe(n.staff === out && !n.red ? 0.4 : 1);
  }
  for (const d of digits) {
    expect(d.shown, `${label} ${JSON.stringify(d)}`).toBe(d.staff === out ? 0.4 : 1);
  }
}

/**
 * The hand of every key pressed now, found and read in one evaluate: a locator's evaluateAll
 * resolves the elements and reads them in two steps, and under a loaded run the cursor could move
 * between the two (a key found pressed was read released, with no hand).
 */
function pressedHands(page: Page): Promise<(string | null)[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.keyboard .is-pressed')].map((e) => e.getAttribute('data-hand')),
  );
}

test.describe('playback with the silent instrument', () => {
  // Issue 50: the score is engraved once and played in performance order; the red goes back to a
  // repeated bar by itself.
  test('a repeat plays again: the red goes back to the repeated bar', async ({ page }) => {
    await page.goto('/?audio=silent#/piece/bach-applicatio-c-major-bwv-994');
    await expect(page.locator('.score-sheet g.measure')).toHaveCount(8, { timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled();
    await openPractice(page);
    await embellishDecided(page);
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    await closePractice(page);
    // The first section (bars 1 to 4) is repeated: from its last bar the music returns to bar 1.
    await seekBar(page, 3);
    await redSettled(page);
    await page.getByRole('button', { name: 'Play' }).click();
    await expect.poll(() => redBars(page), { timeout: 6_000 }).toEqual([3]);
    await expect.poll(() => redBars(page), { timeout: 6_000 }).toEqual([0]);
  });

  test('a D.C. al Fine plays the first section again and stops at the Fine', async ({ page }) => {
    await page.goto('/?audio=silent#/piece/burgmuller-op100-no6-progres');
    await expect(page.locator('.score-sheet g.measure')).toHaveCount(16, { timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled();
    await openPractice(page);
    await embellishDecided(page);
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    await closePractice(page);
    await seekBar(page, 15); // the last bar, marked D.C. al Fine
    await redSettled(page);
    expect(await redBars(page)).toEqual([15]);
    await page.getByRole('button', { name: 'Play' }).click();
    await expect.poll(() => redBars(page), { timeout: 6_000 }).toEqual([0]);
    // Right steps through the second hearing of the first section, to bar 7 (the Fine's bar).
    for (let bar = 1; bar <= 6; bar++) {
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => redBars(page), { timeout: 4_000 }).toEqual([bar]);
    }
    // The piece ends at the Fine: bars 9 to 16 are not heard again.
    const seen: number[] = [];
    await expect
      .poll(
        async () => {
          seen.push(...(await redBars(page)));
          return page.getByRole('button', { name: 'Play' }).isVisible();
        },
        { timeout: 10_000, intervals: [100] },
      )
      .toBe(true);
    expect(seen.length).toBeGreaterThan(0);
    expect(Math.max(...seen)).toBeLessThan(8);
  });

  // T10 (spec 14): a pause keeps the last group heard red and its keys pressed, Play plain; Rewind
  // clears them and gives the red back to Play.
  test('play moves a red cursor through the score and lights keys with finger numbers; pause keeps the last group heard red; Rewind gives the red to Play', async ({
    page,
  }) => {
    await page.goto('/?audio=silent#/piece/twinkle-twinkle-little-star');
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
    // The count-in (one 2.4 s bar here) holds the first red note back; the next test covers it.
    await openPractice(page);
    await embellishDecided(page);
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.locator('.score-sheet .is-red').first()).toBeVisible({ timeout: 5_000 });
    const roots = await expectOneRed(page, 'playing');
    expect(roots.every((r) => r.inSheet)).toBe(true);
    const tick1 = Number(roots[0]!.onsetTick);
    await page.waitForTimeout(1500);
    const roots2 = await expectOneRed(page, 'playing later');
    expect(Number(roots2[0]!.onsetTick)).toBeGreaterThan(tick1);
    const pressed = page.locator('.keyboard .is-pressed');
    expect(await pressed.count()).toBeGreaterThan(0);
    await expect(pressed.first().locator('text')).toHaveText(/^[1-5]$/);
    await page.getByRole('button', { name: 'Pause' }).click();
    const paused = await expectOneRed(page, 'paused');
    expect(paused.every((r) => r.inSheet)).toBe(true);
    expect(Number(paused[0]!.onsetTick)).toBeGreaterThanOrEqual(Number(roots2[0]!.onsetTick));
    await expect(page.getByRole('button', { name: 'Play' })).not.toHaveClass(/is-red/);
    expect(await page.locator('.keyboard .is-pressed').count()).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Rewind' }).click();
    // The red flies home from the last note heard to Play (motion study 05), then Play has it.
    await expect(page.getByRole('button', { name: 'Play' })).toHaveClass(/is-red/);
    const rewound = await expectOneRed(page, 'rewound');
    expect(rewound[0]!.tag).toBe('button');
    await expect(page.locator('.score-sheet .is-red')).toHaveCount(0);
    await expect(page.locator('.keyboard .is-pressed')).toHaveCount(0);
  });

  // T10 (spec 14): a pause in the count-in heard nothing, so nothing is marked and Play is red.
  test('paused in the count-in: nothing marked, Play red', async ({ page }) => {
    await page.goto('/?audio=silent#/piece/twinkle-twinkle-little-star');
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
    await openPractice(page);
    await embellishDecided(page);
    await page.getByRole('slider', { name: 'Tempo' }).fill('50');
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.getByRole('status')).toHaveText('1');
    await page.getByRole('button', { name: 'Pause' }).click();
    const roots = await expectOneRed(page, 'paused in the count-in');
    expect(roots[0]!.tag).toBe('button');
    await expect(page.getByRole('button', { name: 'Play' })).toHaveClass(/is-red/);
    await expect(page.locator('.score-sheet .is-red')).toHaveCount(0);
  });

  // T10 (spec 14) and Review Focus 4, Task 5 review: paused on Happy Birthday's pickup (the
  // right hand alone), the left hand has no note yet, so switching to it clears the marks and
  // Play turns red; switching back to both hands marks the pickup again, since the position to
  // resume is unchanged; Rewind gives the red to Play. One red root at every step.
  test('a hand switch while paused clears or marks again; Rewind gives the red to Play', async ({
    page,
  }) => {
    await page.goto(`/?audio=silent#/piece/${HAPPY_BIRTHDAY}`);
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(HAPPY_BIRTHDAY_DIGITS, {
      timeout: 20_000,
    });
    await openPractice(page);
    await embellishDecided(page);
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    // At 50 % the pickup lasts 1.2 s before the left hand's first note.
    await page.getByRole('slider', { name: 'Tempo' }).fill('50');
    await page.getByRole('button', { name: 'Play' }).click();
    await page.waitForFunction(
      () => {
        const hook = (window as unknown as { __digitus2?: TestHook }).__digitus2;
        return hook !== undefined && hook.cursorSec() === 0 && hook.positionSec() > 0.05;
      },
      undefined,
      { polling: 'raf', timeout: 10_000 },
    );
    await page.getByRole('button', { name: 'Pause' }).click();
    expect(await position(page)).toBeLessThan(0.6); // still on the pickup
    const pickup = await expectOneRed(page, 'paused on the pickup');
    expect(pickup.every((r) => r.inSheet)).toBe(true);
    await expect(page.getByRole('button', { name: 'Play' })).not.toHaveClass(/is-red/);

    await page.getByRole('radio', { name: 'Left hand' }).check();
    const left = await expectOneRed(page, 'paused, left hand');
    expect(left[0]!.tag).toBe('button');
    await expect(page.getByRole('button', { name: 'Play' })).toHaveClass(/is-red/);
    await expect(page.locator('.score-sheet .is-red')).toHaveCount(0);

    await page.getByRole('radio', { name: 'Both hands' }).check();
    const both = await expectOneRed(page, 'paused, both hands again');
    expect(both.every((r) => r.inSheet)).toBe(true);
    expect(both[0]!.onsetTick).toBe(pickup[0]!.onsetTick);
    await expect(page.getByRole('button', { name: 'Play' })).not.toHaveClass(/is-red/);

    await page.getByRole('button', { name: 'Rewind' }).click();
    // The red flies home to Play first (motion study 05).
    await expect(page.getByRole('button', { name: 'Play' })).toHaveClass(/is-red/);
    const rewound = await expectOneRed(page, 'rewound');
    expect(rewound[0]!.tag).toBe('button');
  });

  // T10, Task 5 review (the blocker): with one hand practised, Play after a pause leads in to
  // that hand's next note, which can be bars away. A pause in that lead-in still has the group
  // heard before it to resume from: it stays red and Play stays plain.
  test("paused again in a resume's lead-in: the last group heard is marked, Play plain", async ({
    page,
  }) => {
    await page.goto('/?audio=silent#/piece/twinkle-twinkle-little-star');
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
    await openPractice(page);
    await embellishDecided(page);
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    await page.getByRole('radio', { name: 'Left hand' }).check();
    await page.getByRole('slider', { name: 'Tempo' }).fill('50');
    // A left-hand onset after the first second with at least 0.6 s (1.2 s at 50 %) to the next.
    const secs = await page.evaluate(() =>
      (window as unknown as { __digitus2: TestHook }).__digitus2.groupSecs(),
    );
    const at = secs.findIndex((s, i) => s >= 1 && (secs[i + 1] ?? Infinity) - s >= 0.6);
    expect(at).toBeGreaterThanOrEqual(0);
    const target = secs[at]!;
    const next = secs[at + 1]!;
    await page.getByRole('button', { name: 'Play' }).click();
    await page.waitForFunction(
      (sec) => (window as unknown as { __digitus2: TestHook }).__digitus2.cursorSec() === sec,
      target,
      { polling: 'raf', timeout: 15_000 },
    );
    await page.getByRole('button', { name: 'Pause' }).click();
    const paused = await expectOneRed(page, 'paused');
    expect(paused.every((r) => r.inSheet)).toBe(true);

    await page.getByRole('button', { name: 'Play' }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Pause' }).click();
    expect(await position(page)).toBeLessThan(next); // paused in the lead-in
    const again = await expectOneRed(page, "paused in the resume's lead-in");
    expect(again.every((r) => r.inSheet)).toBe(true);
    expect(again[0]!.onsetTick).toBe(paused[0]!.onsetTick);
    await expect(page.getByRole('button', { name: 'Play' })).not.toHaveClass(/is-red/);
  });

  // T10 with Task 4's loop prefill: the paused cursor's bar is where "Loop bars" starts.
  // Twinkle is 100 qpm in 4/4: bar 2 runs from 2.4 s to 4.8 s.
  test('paused in the second bar, "Loop bars" starts there: bars 2 to 3', async ({ page }) => {
    await page.goto('/?audio=silent#/piece/twinkle-twinkle-little-star');
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
    await openPractice(page);
    await embellishDecided(page);
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    await page.getByRole('button', { name: 'Play' }).click();
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            (
              window as unknown as { __digitus2: { positionSec(): number } }
            ).__digitus2.positionSec(),
          ),
        { timeout: 10_000 },
      )
      .toBeGreaterThan(2.7);
    await page.getByRole('button', { name: 'Pause' }).click();
    await page.getByRole('checkbox', { name: 'Loop bars' }).check();
    await expect(page.getByLabel('Loop from bar')).toHaveValue('2');
    await expect(page.getByLabel('Loop to bar')).toHaveValue('3');
    await expectOneRed(page, 'paused, loop set');
  });

  // UI batch review: a loop set while paused that leaves the pause position outside it makes
  // Play start at the loop's first bar, so the marked group is not where Play resumes: the marks
  // clear and Play takes the red. Unticking the loop brings the resume point back.
  test('paused in bar 1, a loop of bars 6 to 7 gives the red to Play; unticking marks bar 1 again', async ({
    page,
  }) => {
    await page.goto('/?audio=silent#/piece/twinkle-twinkle-little-star');
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
    await openPractice(page);
    await embellishDecided(page);
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    await page.getByRole('button', { name: 'Play' }).click();
    await page.waitForFunction(
      () => {
        const hook = (window as unknown as { __digitus2?: TestHook }).__digitus2;
        return hook !== undefined && hook.positionSec() > 1;
      },
      undefined,
      { polling: 'raf', timeout: 10_000 },
    );
    await page.getByRole('button', { name: 'Pause' }).click();
    expect(await position(page)).toBeLessThan(2.4); // still in bar 1
    const paused = await expectOneRed(page, 'paused in bar 1');
    expect(paused.every((r) => r.inSheet)).toBe(true);

    await setLoopBars(page, '6', '7');
    const looped = await expectOneRed(page, 'paused in bar 1, loop 6 to 7');
    expect(looped[0]!.tag).toBe('button');
    await expect(page.getByRole('button', { name: 'Play' })).toHaveClass(/is-red/);
    await expect(page.locator('.score-sheet .is-red')).toHaveCount(0);
    await expect(page.locator('.keyboard .is-pressed')).toHaveCount(0);

    await page.getByRole('checkbox', { name: 'Loop bars' }).uncheck();
    const back = await expectOneRed(page, 'paused in bar 1, loop unticked');
    expect(back.every((r) => r.inSheet)).toBe(true);
    expect(back[0]!.onsetTick).toBe(paused[0]!.onsetTick);
    await expect(page.getByRole('button', { name: 'Play' })).not.toHaveClass(/is-red/);
  });

  // Polish plan Task 3 and Review Focus 3 (review S3): the count-in used to light the first notes
  // and their keys 2.4 s before they sounded. It now counts the beats in the status line, Pause
  // stays the screen's one red element, and the first note turns red when it is heard.
  test('no note is red during the count-in; the status line counts', async ({ page }) => {
    await page.goto('/?audio=silent#/piece/twinkle-twinkle-little-star');
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
    await openPractice(page);
    await embellishDecided(page);
    await expect(page.getByRole('checkbox', { name: 'Count-in' })).toBeChecked();
    const sampled = sampleUntilFirstRedNote(page, 10_000);
    await page.getByRole('button', { name: 'Play' }).click();
    // Halfway through Twinkle's count-in (one bar: 4 beats of 0.6 s), Pause is the one red element.
    await expect(page.getByRole('status')).toHaveText('2');
    const counting = await expectOneRed(page, 'count-in');
    expect(counting).toHaveLength(1);
    expect(counting[0]!.tag).toBe('button');
    expect(counting[0]!.className).toContain('play-button');
    const frames = await sampled;

    const start = frames.findIndex((f) => f.button === 'Pause');
    const firstRed = frames.findIndex((f) => f.redNotes > 0);
    expect(start, 'Play turned into Pause').toBeGreaterThanOrEqual(0);
    expect(firstRed, 'a note turned red after the count-in').toBeGreaterThan(start);
    const countIn = frames.slice(start, firstRed);
    // The status line, in the dock, counts the beats in turn: 1, 2, 3, 4, and nothing else.
    expect(runs(countIn.map((f) => f.status))).toEqual(['1', '2', '3', '4']);
    expect(countIn.every((f) => f.statusInDock)).toBe(true);
    // Before the music starts no note is red and no key is pressed; Pause is the red element
    // until, on the last beat, the red leaves it to travel to the first note (motion study 05):
    // in every frame exactly one of the two.
    for (const f of countIn) {
      const at = JSON.stringify(f);
      expect(f.redNotes, at).toBe(0);
      expect(f.pressed, at).toBe(0);
      expect(f.buttonRed !== f.ghostRed, at).toBe(true);
    }
    // The red travels only in the last moment before the note: a 200 ms flight (and a frame).
    const flying = countIn.filter((f) => f.ghostRed);
    expect(flying.length, 'the red travelled to the first note').toBeGreaterThan(0);
    expect(frames[firstRed]!.t - flying[0]!.t).toBeLessThan(300);
    expect(countIn.slice(countIn.indexOf(flying[0]!)).every((f) => f.ghostRed)).toBe(true);
    // The first note turns red once it is heard: the clock has passed its onset (0 s), the count
    // is gone, Pause is plain, and the first notes' keys are pressed with it.
    const first = frames[firstRed]!;
    const at = JSON.stringify(first);
    expect(first.tick, at).toBe('0');
    expect(first.position, at).toBeGreaterThan(0);
    expect(first.status, at).toBe('');
    expect(first.buttonRed, at).toBe(false);
    expect(first.ghostRed, at).toBe(false);
    expect(first.pressed, at).toBeGreaterThan(0);
    // ...and promptly: the transport notices the start on its next tick (25 ms), and the cursor
    // marks the notes in the render that follows.
    const late = countIn.filter((f) => f.position > 0).length;
    const lag = (first.position * 1000).toFixed(1);
    const notes = test.info().annotations;
    notes.push({ type: 'first note heard before it turned red (ms)', description: lag });
    notes.push({ type: 'count-in frames after the first note was heard', description: `${late}` });
    expect(first.position, at).toBeLessThan(0.1);
    // The count lasted the bar: about 2.4 s from "1" to the first red note.
    const shown = first.t - countIn[0]!.t;
    notes.push({ type: 'count-in shown (ms)', description: shown.toFixed(0) });
    expect(shown).toBeGreaterThan(2_000);
    const roots = await expectOneRed(page, 'after the count-in');
    expect(roots.every((r) => r.inSheet)).toBe(true);
  });

  // Polish plan Task 3 (review S3): the first Play with the real instrument loaded the samples
  // (2.35 s in the review) with no visible change. They are served here 1 s after each request.
  test('the first Play with the real piano says "Loading the piano…" until playback starts', async ({
    page,
  }) => {
    const requested = await delayPianoSamples(page, 1_000);
    await page.goto('/#/piece/twinkle-twinkle-little-star');
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
    await openPractice(page);
    await embellishDecided(page);
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    // The status line is a live region that is always in the dock, empty until there is something
    // to say, so a screen reader announces its first words ("Loading the piano…", the first "1").
    const status = page.getByRole('status');
    await expect(page.locator('.dock').getByRole('status')).toHaveCount(1);
    await expect(status).toBeEmpty();
    const sampled = sampleUntilFirstRedNote(page, 15_000);
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(status).toHaveText(LOADING_THE_PIANO);
    await expect(page.locator('.dock').getByRole('status')).toHaveText(LOADING_THE_PIANO);
    await expect(status).toBeInViewport();
    // Play stays the one red element, busy and unavailable, while the samples load.
    await expect(page.getByRole('button', { name: 'Play' })).toHaveAttribute('aria-busy', 'true');
    const loading = await expectOneRed(page, 'loading the piano');
    expect(loading[0]!.tag).toBe('button');
    await expectNoSeriousA11y(page, 'loading the piano');
    const frames = await sampled;

    const shown = frames.findIndex((f) => f.status === LOADING_THE_PIANO);
    const start = frames.findIndex((f) => f.button === 'Pause');
    expect(shown, 'the loading line showed').toBeGreaterThanOrEqual(0);
    expect(start, 'playback started after it').toBeGreaterThan(shown);
    // From the first frame that says it until playback starts: the same line, a red Play, no red note.
    for (const f of frames.slice(shown, start)) {
      const at = JSON.stringify(f);
      expect(f.status, at).toBe(LOADING_THE_PIANO);
      expect(f.statusInDock, at).toBe(true);
      expect(f.button, at).toBe('Play');
      expect(f.buttonRed, at).toBe(true);
      expect(f.redNotes, at).toBe(0);
    }
    // Then it plays (no count-in here): the line empties as Play turns into Pause.
    expect(frames[start]!.status, JSON.stringify(frames[start])).toBe('');
    const lasted = frames[start]!.t - frames[shown]!.t;
    test.info().annotations.push({ type: 'loading shown (ms)', description: lasted.toFixed(0) });
    expect(lasted).toBeGreaterThan(900);
    expect(requested.length, 'piano samples requested').toBeGreaterThan(0);
    // The samples come from the app's own site, under their stored names (issue #51).
    const origin = new URL(page.url()).origin;
    for (const url of requested) {
      expect(new URL(url).origin, url).toBe(origin);
      expect(new URL(url).pathname, url).toMatch(/^\/piano\/[A-Za-z0-9_-]+\.ogg$/);
    }
    await expect(page.locator('.score-sheet .is-red').first()).toBeVisible();
    await expect(status).toBeEmpty();
    const roots = await expectOneRed(page, 'playing the real piano');
    expect(roots.every((r) => r.inSheet)).toBe(true);
  });

  // Issue #51: the Vite servers answer a missing file with the app's page and status 200. The
  // piano rejects a sample that is not audio, so Play says so instead of playing silence.
  test('a piano sample answered with a page instead of audio: Play says the piano sounds could not be loaded', async ({
    page,
  }) => {
    await page.route(PIANO_SAMPLES, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>digitus2</title>',
      }),
    );
    await page.goto('/#/piece/twinkle-twinkle-little-star');
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.getByText(/piano sounds could not be loaded/)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pause' })).toHaveCount(0);
  });

  // Polish plan Task 3 review (the blocker): Happy Birthday with the left hand alone. The pickup
  // is the right hand's, so once the count-in (or, without one, Play) had passed the start, the
  // first left-hand note turned red, with its keys pressed, about 580 ms before it sounded. Now
  // nothing in the score is red and no key pressed until that note is heard; Pause keeps the red
  // meanwhile, and no frame has two red elements or none.
  for (const countIn of [true, false]) {
    test(`the left hand alone after the right hand's pickup, count-in ${countIn ? 'on' : 'off'}: no note is red before it sounds`, async ({
      page,
    }) => {
      await page.goto(`/?audio=silent#/piece/${HAPPY_BIRTHDAY}`);
      await expect(page.locator('.score-sheet g.fing')).toHaveCount(HAPPY_BIRTHDAY_DIGITS, {
        timeout: 20_000,
      });
      await openPractice(page);
      await embellishDecided(page);
      await page.getByRole('radio', { name: 'Left hand' }).check();
      const countInBox = page.getByRole('checkbox', { name: 'Count-in' });
      await expect(countInBox).toBeChecked(); // the default
      if (!countIn) await countInBox.uncheck();
      // The first notes the cursor can mark: the left hand's, on the downbeat after the pickup.
      const groupSecs = () =>
        page.evaluate(() => (window as unknown as { __digitus2: TestHook }).__digitus2.groupSecs());
      await expect.poll(async () => (await groupSecs())[0]).toBeCloseTo(0.6, 3);
      const firstLeft = (await groupSecs())[0]!;

      const sampled = sampleUntilFirstRedNote(page, 10_000);
      await page.getByRole('button', { name: 'Play' }).click();
      const frames = await sampled;
      const start = frames.findIndex((f) => f.button === 'Pause');
      const firstRed = frames.findIndex((f) => f.redNotes > 0);
      expect(start, 'Play turned into Pause').toBeGreaterThanOrEqual(0);
      expect(firstRed, 'a note turned red').toBeGreaterThan(start);

      // Until the left hand's first note is heard: no note red, no key pressed, Pause red. That
      // is the start delay, the count-in's two beats and the pickup (1.85 s, about 110 frames at
      // 60 a second), or without a count-in the start delay and the pickup (0.65 s, about 39).
      const before = frames.slice(start).filter((f) => f.position < firstLeft);
      expect(before.length, 'frames before the first left-hand note').toBeGreaterThan(
        countIn ? 70 : 20,
      );
      for (const f of before) {
        const at = JSON.stringify(f);
        expect(f.redNotes, at).toBe(0);
        expect(f.pressed, at).toBe(0);
        // Pause, or in the last moment the red on its way to the note (motion study 05).
        expect(f.buttonRed !== f.ghostRed, at).toBe(true);
      }
      // In every frame, one red element: Play, then Pause, the red on its way, then the cursor.
      for (const f of frames) {
        const reds = (f.buttonRed ? 1 : 0) + (f.ghostRed ? 1 : 0) + (f.redNotes > 0 ? 1 : 0);
        expect(reds, JSON.stringify(f)).toBe(1);
      }
      // The count keeps the bar grid (polish plan Task 3 review): the pickup is beat 3 of a 3/4
      // bar, so the count is "1", "2", and the pickup enters on 3; then the line is empty while
      // the muted pickup plays. A whole bar before it put the real downbeat on the counted 2.
      expect(runs(frames.slice(start, firstRed).map((f) => f.status))).toEqual(
        countIn ? ['1', '2', ''] : [''],
      );
      if (countIn) {
        // The pickup is heard (the clock leaves 0) two beats of 0.6 s after the count starts with
        // Play (plus the 50 ms start delay), not three (1.85 s).
        const counted = frames.findIndex((f) => f.status === '1');
        const heard = frames.findIndex((f) => f.position > 0);
        const entered = frames[heard]!.t - frames[counted]!.t;
        test.info().annotations.push({
          type: 'count-in "1" to the pickup heard (ms)',
          description: entered.toFixed(0),
        });
        expect(entered).toBeGreaterThan(1_100);
        expect(entered).toBeLessThan(1_600);
      }

      // The first red notes are the left hand's first, once they are heard, with their keys.
      const first = frames[firstRed]!;
      const at = JSON.stringify(first);
      expect(first.position, at).toBeGreaterThanOrEqual(firstLeft);
      expect(first.buttonRed, at).toBe(false);
      expect(first.ghostRed, at).toBe(false);
      expect(first.status, at).toBe('');
      expect(first.pressed, at).toBeGreaterThan(0);
      expect(new Set(first.pressedHands), at).toEqual(new Set(['L']));
      const lag = first.position - firstLeft;
      const notes = test.info().annotations;
      notes.push({
        type: 'frames before the first left-hand note',
        description: `${before.length}`,
      });
      notes.push({
        type: 'first left-hand note heard before it turned red (ms)',
        description: (lag * 1000).toFixed(1),
      });
      expect(lag, at).toBeLessThan(0.1);
      const roots = await expectOneRed(
        page,
        `the left hand playing, count-in ${countIn ? 'on' : 'off'}`,
      );
      expect(roots.every((r) => r.inSheet)).toBe(true);
    });
  }

  // Polish plan Task 3 review: Happy Birthday's left hand alone, looping bars 1 and 2 (the pickup
  // bar and the first full bar, 2.4 s). After every wrap the left hand's chord stayed red, with
  // its keys, through the muted pickup (52 frames), 0.6 s before it sounded again. A wrap to a
  // start where the hands played rest now leads in: the marks of the pass that ended stay only
  // until the transport's next tick (25 ms) reports it, then Pause is red until the chord sounds.
  test('the left hand alone, looping from the pickup: after every wrap no note is red before it sounds', async ({
    page,
  }) => {
    await page.goto(`/?audio=silent#/piece/${HAPPY_BIRTHDAY}`);
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(HAPPY_BIRTHDAY_DIGITS, {
      timeout: 20_000,
    });
    await openPractice(page);
    await embellishDecided(page);
    await page.getByRole('radio', { name: 'Left hand' }).check();
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    await setLoopBars(page, '1', '2');
    const groupSecs = () =>
      page.evaluate(() => (window as unknown as { __digitus2: TestHook }).__digitus2.groupSecs());
    await expect.poll(async () => (await groupSecs())[0]).toBeCloseTo(0.6, 3);
    const firstLeft = (await groupSecs())[0]!;

    const sampled = sampleFrames(page, 6_500); // two wraps, at 2.4 s and 4.8 s
    await page.getByRole('button', { name: 'Play' }).click();
    const frames = await sampled;
    const start = frames.findIndex((f) => f.button === 'Pause');
    expect(start, 'Play turned into Pause').toBeGreaterThanOrEqual(0);
    const playing = frames.slice(start);

    // In every frame, one red element: Pause, the red on its way to the first note (from Play
    // only, motion study 05), or the cursor.
    for (const f of playing) {
      const reds = (f.buttonRed ? 1 : 0) + (f.ghostRed ? 1 : 0) + (f.redNotes > 0 ? 1 : 0);
      expect(reds, JSON.stringify(f)).toBe(1);
    }
    // A note turns red only once it is heard: whenever the cursor marks a new group, the clock
    // has reached it.
    playing.forEach((f, k) => {
      const prev = playing[k - 1];
      const fresh =
        f.redNotes > 0 && (!prev || prev.redNotes === 0 || prev.cursorSec !== f.cursorSec);
      if (fresh) expect(f.cursorSec, JSON.stringify(f)).toBeLessThanOrEqual(f.position + 1e-3);
    });

    // Each pass after a wrap (the clock jumps back to the loop's start), until the chord sounds.
    const wraps = playing
      .map((f, k) => (k > 0 && f.position < playing[k - 1]!.position - 1 ? k : -1))
      .filter((k) => k > 0);
    const holds: number[] = [];
    const lags: number[] = [];
    for (const w of wraps) {
      const sounds = playing.findIndex((f, k) => k >= w && f.position >= firstLeft);
      if (sounds < 0) continue; // the sampling ended in this pass
      const lead = playing.slice(w, sounds);
      // The pass that ended keeps its marks for at most a tick, then nothing is red in the sheet
      // and no key is pressed, and Pause is red, until the chord is heard.
      const held = lead.findIndex((f) => f.redNotes === 0);
      expect(held, `the marks were cleared after the wrap at frame ${w}`).toBeGreaterThanOrEqual(0);
      holds.push(lead[held]!.position);
      for (const f of lead.slice(held)) {
        const at = JSON.stringify(f);
        expect(f.redNotes, at).toBe(0);
        expect(f.pressed, at).toBe(0);
        expect(f.buttonRed, at).toBe(true);
      }
      expect(lead[held]!.position, 'cleared within 100 ms of the wrap').toBeLessThan(0.1);
      // The chord turns red again once it is heard, with its keys.
      const back = playing.findIndex((f, k) => k >= sounds && f.redNotes > 0);
      expect(back, 'the chord turned red again').toBeGreaterThanOrEqual(0);
      const chord = playing[back]!;
      expect(chord.cursorSec, JSON.stringify(chord)).toBeCloseTo(firstLeft, 6);
      expect(new Set(chord.pressedHands), JSON.stringify(chord)).toEqual(new Set(['L']));
      lags.push(chord.position - firstLeft);
      expect(chord.position - firstLeft, JSON.stringify(chord)).toBeLessThan(0.1);
    }
    expect(holds.length, 'passes after a wrap sampled to the chord').toBeGreaterThanOrEqual(2);
    const notes = test.info().annotations;
    notes.push({
      type: 'clock when the marks cleared after each wrap (ms into the pass)',
      description: holds.map((s) => (s * 1000).toFixed(1)).join(', '),
    });
    notes.push({
      type: 'chord heard before it turned red after each wrap (ms)',
      description: lags.map((s) => (s * 1000).toFixed(1)).join(', '),
    });
    await expectOneRed(page, 'looping the left hand from the pickup');
    await expectNoSeriousA11y(page, 'looping the left hand from the pickup');
  });

  test('left hand only: no right-hand keys light up', async ({ page }) => {
    await page.goto('/?audio=silent#/piece/twinkle-twinkle-little-star');
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
    await openPractice(page);
    await embellishDecided(page);
    await page.getByRole('radio', { name: 'Left hand' }).click();
    // The count-in (2.4 s here) presses no key until the first note sounds: play through it.
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    await page.getByRole('button', { name: 'Play' }).click();
    await page.waitForTimeout(1200);
    const hands = await pressedHands(page);
    expect(hands.length).toBeGreaterThan(0);
    expect(new Set(hands)).toEqual(new Set(['L']));
  });

  test('a held note stays pressed while the other hand moves on', async ({ page }) => {
    // Twinkle's left hand holds whole and half notes under a quarter-note melody.
    await page.goto('/?audio=silent#/piece/twinkle-twinkle-little-star');
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
    await openPractice(page);
    await embellishDecided(page);
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    await page.getByRole('button', { name: 'Play' }).click();
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(400);
      const hands = await pressedHands(page);
      expect(new Set(hands), `sample ${i}`).toEqual(new Set(['L', 'R']));
    }
  });

  // Polish plan Task 4 (review S5, S4 and S10): a pressed white key was --gray-1 (#f2f2f2) on
  // white, almost invisible; no key said which hand plays it; and with one hand muted the
  // keyboard showed nothing of that hand. Pressed keys, white and black, are now --gray-2 with
  // the finger, and the muted hand's keys show dimmed (40 % opacity), not pressed. T11 (spec 15):
  // the L or R shows only in bars where the hands come within a fifth, Happy Birthday's bars 2
  // and 3 (0-based, from about 2 s), on both hands' keys together or on none; each phase must
  // see letters, so the dimmed letter's opacity is checked on a real one.
  test('pressed keys are gray with the finger, lettered only where the hands come close; the muted hand shows dimmed', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' }); // the keys' fill transition is instant
    await page.goto(`/?audio=silent#/piece/${HAPPY_BIRTHDAY}`);
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(HAPPY_BIRTHDAY_DIGITS, {
      timeout: 20_000,
    });
    await openPractice(page);
    await embellishDecided(page);
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    // Select and read in one browser task: playback can release a key between
    // Playwright's selector lookup and evaluateAll callback on a busy CI runner.
    const keys = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('.keyboard .key.is-pressed, .keyboard .key.is-muted')].map(
          (k) => {
            const midi = k.getAttribute('data-midi');
            const mark = document.querySelector(`.keyboard .key-hand[data-for-midi="${midi}"]`);
            return {
              midi,
              black: k.classList.contains('is-black'),
              pressed: k.classList.contains('is-pressed'),
              muted: k.classList.contains('is-muted'),
              hand: k.getAttribute('data-hand'),
              fill: getComputedStyle(k.querySelector('rect')!).fill,
              opacity: getComputedStyle(k).opacity,
              finger: k.querySelector('text')?.textContent ?? null,
              mark: mark?.textContent ?? null,
              markOpacity: mark ? getComputedStyle(mark).opacity : null,
            };
          },
        ),
      );
    type Key = Awaited<ReturnType<typeof keys>>[number];
    const lettered = (s: Key[]) => s.some((k) => k.mark !== null);
    /** Both hands lettered together or not at all (spec 15, rule 4). */
    const allOrNone = (samples: Key[][]) => {
      for (const s of samples) {
        const marks = s.filter((k) => k.mark !== null).length;
        expect(marks === 0 || marks === s.length, JSON.stringify(s)).toBe(true);
      }
    };

    // Both hands, sampled every 100 ms until a black key (F#4, bar 2) and a white key were down
    // and a sample was lettered.
    const bothSamples: Key[][] = [];
    await page.getByRole('button', { name: 'Play' }).click();
    await expect
      .poll(
        async () => {
          bothSamples.push(await keys());
          return (
            bothSamples.some((s) => s.some((k) => k.black)) &&
            bothSamples.some((s) => s.some((k) => !k.black)) &&
            bothSamples.some(lettered)
          );
        },
        { timeout: 15_000, intervals: [100] },
      )
      .toBe(true);
    allOrNone(bothSamples);
    expect(
      bothSamples.some((s) => s.length > 0 && !lettered(s)),
      'bars 0 and 1 carry no letter',
    ).toBe(true);
    const both = bothSamples.flat();
    for (const k of both) {
      const at = JSON.stringify(k);
      expect(k.pressed && !k.muted, at).toBe(true);
      expect(k.fill, at).toBe('rgb(204, 204, 204)'); // --gray-2
      expect(k.opacity, at).toBe('1');
      expect(['L', 'R'], at).toContain(k.hand);
      expect(k.mark === null || k.mark === k.hand, at).toBe(true);
      expect(k.finger, at).toMatch(/^[1-5]$/);
    }
    expect(new Set(both.map((k) => k.hand))).toEqual(new Set(['L', 'R']));
    const playingRoots = await expectOneRed(page, 'pressed keys, both hands');
    expect(playingRoots.every((r) => r.inSheet)).toBe(true);

    // The right hand alone: the left hand's keys show dimmed under the right hand's pressed keys.
    await page.getByRole('radio', { name: 'Right hand' }).check();
    await expect(page.locator('.keyboard .key.is-muted').first()).toBeAttached({ timeout: 10_000 });
    // From the start again, with the right hand alone, so the samples cross bars 2 and 3.
    await page.getByRole('button', { name: 'Rewind' }).click();
    const oneSamples: Key[][] = [];
    await expect
      .poll(
        async () => {
          oneSamples.push(await keys());
          return (
            oneSamples.some((s) => s.some((k) => k.muted)) &&
            oneSamples.some((s) => s.some((k) => k.pressed)) &&
            oneSamples.some((s) => s.some((k) => k.muted && k.mark !== null))
          );
        },
        { timeout: 15_000, intervals: [100] },
      )
      .toBe(true);
    allOrNone(oneSamples);
    const one = oneSamples.flat();
    for (const k of one) {
      const at = JSON.stringify(k);
      expect(k.pressed !== k.muted, at).toBe(true);
      expect(k.hand, at).toBe(k.muted ? 'L' : 'R');
      expect(k.opacity, at).toBe(k.muted ? '0.4' : '1');
      expect(k.mark === null || k.mark === k.hand, at).toBe(true);
      if (k.mark !== null) expect(k.markOpacity, at).toBe(k.muted ? '0.4' : '1');
      expect(k.fill, at).toBe('rgb(204, 204, 204)');
      expect(k.finger, at).toMatch(/^[1-5]$/);
    }
    const oneHandRoots = await expectOneRed(page, 'the right hand alone');
    expect(oneHandRoots.every((r) => r.inSheet)).toBe(true);
    await expectNoSeriousA11y(page, 'the right hand alone');
  });

  // Task 4 review (the blocker): the muted hand's dimmed keys changed only at the onsets of the
  // hand played. With Twinkle's left hand alone, which holds C3 through bar 1, the right hand's
  // C4 stayed dimmed from 0.07 s to 2.44 s while that hand played C C G G (G4 from 1.2 s). The
  // dimmed keys now follow the right hand's own notes.
  test("the muted hand's dimmed keys follow its own notes while the hand played holds one", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?audio=silent#/piece/twinkle-twinkle-little-star');
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
    await openPractice(page);
    await embellishDecided(page);
    await page.getByRole('radio', { name: 'Left hand' }).check();
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    const groupSecs = () =>
      page.evaluate(() => (window as unknown as { __digitus2: TestHook }).__digitus2.groupSecs());
    // The left hand strikes at 0 s and next at 2.4 s: it holds through bar 1.
    await expect.poll(async () => (await groupSecs()).length).toBeGreaterThan(1);
    const [firstLeft, nextLeft] = await groupSecs();
    expect(firstLeft).toBeCloseTo(0, 6);
    expect(nextLeft).toBeCloseTo(2.4, 6);

    const sampled = sampleFrames(page, 3_000);
    await page.getByRole('button', { name: 'Play' }).click();
    const frames = (await sampled).filter((f) => f.button === 'Pause' && f.redNotes > 0);
    const between = (from: number, to: number) =>
      frames.filter((f) => f.position >= from && f.position < to);
    // C4 C4 (0 to 1.2 s), then G4 G4 (1.2 to 2.4 s): 100 ms clear of each change for the frame
    // the keyboard takes to follow.
    const c = between(0.1, 1.1);
    const g = between(1.3, 2.3);
    expect(c.length, 'frames under C C').toBeGreaterThan(20);
    expect(g.length, 'frames under G G').toBeGreaterThan(20);
    for (const f of c) expect(f.dimmed, JSON.stringify(f)).toEqual([60]);
    for (const f of g) expect(f.dimmed, JSON.stringify(f)).toEqual([67]);
    // Meanwhile the left hand's C3 is pressed, alone, and the cursor stays on its onset.
    for (const f of between(0.1, 2.3)) {
      const at = JSON.stringify(f);
      expect(f.pressedHands, at).toEqual(['L']);
      expect(f.cursorSec, at).toBeCloseTo(firstLeft!, 6);
    }
    // When the dimmed key turned to G4, measured from the right hand's G4 being heard.
    const turned = frames.find((f) => f.dimmed.includes(67));
    expect(turned, 'G4 dimmed').toBeDefined();
    expect(turned!.position).toBeLessThan(nextLeft!);
    test.info().annotations.push({
      type: 'G4 heard before its key was dimmed (ms)',
      description: ((turned!.position - 1.2) * 1000).toFixed(1),
    });
    await expectOneRed(page, 'the left hand alone, its right hand dimmed');
    await expectNoSeriousA11y(page, 'the left hand alone, its right hand dimmed');
  });

  // Task 4 review (S10): one-hand practice dimmed only the keyboard, so the score did not show
  // which hand is played; and a dimmed black key let the white keys' outlines run through it.
  test('one hand selected: the other hand is dimmed in the score too, and a dimmed black key stays opaque', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/?audio=silent#/piece/${HAPPY_BIRTHDAY}`);
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(HAPPY_BIRTHDAY_DIGITS, {
      timeout: 20_000,
    });
    const sheetDims = page.locator('.score-sheet .is-muted');
    await expect(sheetDims).toHaveCount(0); // both hands: nothing dimmed

    // The left hand selected, stopped: the right hand's staff and digits at 40 %.
    await openPractice(page);
    await embellishDecided(page);
    await page.getByRole('radio', { name: 'Left hand' }).check();
    await expect(sheetDims.first()).toBeAttached();
    await expectScoreDimmed(page, true, 'left hand, stopped');
    const stopped = await expectOneRed(page, 'left hand, stopped');
    expect(stopped[0]!.tag).toBe('button');
    await expectNoSeriousA11y(page, 'left hand, stopped');

    // Playing: the cursor's notes are the left hand's, in full; the right hand's F#4 (bar 4)
    // shows dimmed on the keyboard, over an opaque paper backing.
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    await page.getByRole('button', { name: 'Play' }).click();
    const blackDimmed = page.locator('.keyboard .key.is-black.is-muted');
    await expect(blackDimmed.first()).toBeAttached({ timeout: 20_000 });
    const backing = await blackDimmed.first().evaluate((key) => {
      const prev = key.previousElementSibling;
      const rect = key.querySelector('rect')!;
      return {
        keyOpacity: getComputedStyle(key).opacity,
        backing: prev?.getAttribute('class') ?? null,
        fill: prev ? getComputedStyle(prev).fill : null,
        opacity: prev ? getComputedStyle(prev).opacity : null,
        same: prev
          ? ['x', 'y', 'width', 'height'].every(
              (a) => prev.getAttribute(a) === rect.getAttribute(a),
            )
          : false,
      };
    });
    expect(backing).toEqual({
      keyOpacity: '0.4',
      backing: 'key-backing',
      fill: 'rgb(255, 255, 255)', // --paper
      opacity: '1',
      same: true,
    });
    await expectScoreDimmed(page, true, 'left hand, playing');
    const playingRoots = await expectOneRed(page, 'left hand, playing');
    expect(playingRoots.every((r) => r.inSheet)).toBe(true);
    await expectNoSeriousA11y(page, 'left hand, playing');

    // The right hand selected: the left hand's staff and digits dimmed instead.
    await page.getByRole('button', { name: 'Pause' }).click();
    await page.getByRole('radio', { name: 'Right hand' }).check();
    await expectScoreDimmed(page, false, 'right hand, stopped');
    // Both hands again: nothing dimmed.
    await page.getByRole('radio', { name: 'Both hands' }).check();
    await expect(sheetDims).toHaveCount(0);
    await expectOneRed(page, 'both hands, stopped');
  });

  test('the cursor is in sync with the transport clock within one frame', async ({ page }) => {
    await page.goto('/?audio=silent#/piece/twinkle-twinkle-little-star');
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
    await openPractice(page);
    await embellishDecided(page);
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    await page.getByRole('button', { name: 'Play' }).click();
    await page.waitForTimeout(2000);
    const { positionSec, cursorSec } = await page.evaluate(
      () =>
        (window as unknown as { __digitus2: { positionSec(): number; cursorSec(): number } })
          .__digitus2 && {
          positionSec: (
            window as never as { __digitus2: { positionSec(): number } }
          ).__digitus2.positionSec(),
          cursorSec: (
            window as never as { __digitus2: { cursorSec(): number } }
          ).__digitus2.cursorSec(),
        },
    );
    expect(Math.abs(positionSec - cursorSec)).toBeLessThan(0.7); // the current group started no more than one Twinkle beat (0.6 s) before the clock

    // The exact oracle, sampled across several groups: read in the frame right after the
    // cursor's own, the marked group is the last one that started at or before the clock (one
    // frame of slack when the clock has just crossed into the next group).
    const marks = new Set<number>();
    for (let i = 0; i < 12; i++) {
      const s = await page.evaluate(
        () =>
          new Promise<{ pos: number; cursor: number; secs: number[] }>((resolve) =>
            requestAnimationFrame(() => {
              const hook = (window as unknown as { __digitus2: TestHook }).__digitus2;
              resolve({
                pos: hook.positionSec(),
                cursor: hook.cursorSec(),
                secs: hook.groupSecs(),
              });
            }),
          ),
      );
      let k = 0;
      while (k + 1 < s.secs.length && s.secs[k + 1]! <= s.pos) k++;
      const justCrossed = k > 0 && s.pos - s.secs[k]! < 1 / 60;
      expect(
        s.cursor === s.secs[k] || (justCrossed && s.cursor === s.secs[k - 1]),
        `sample ${i}: clock ${s.pos} s, cursor on ${s.cursor} s, expected ${s.secs[k]} s`,
      ).toBe(true);
      marks.add(s.cursor);
      await page.waitForTimeout(170);
    }
    expect(marks.size).toBeGreaterThan(3); // the samples span several groups
  });

  test('Enter plays and pauses from the keyboard: the focus stays on the button through the first load', async ({
    page,
  }) => {
    await page.goto('/?audio=silent#/piece/twinkle-twinkle-little-star');
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
    await openPractice(page);
    await embellishDecided(page);
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    const play = page.getByRole('button', { name: 'Play' });
    await expect(play).toBeEnabled();
    await play.focus();
    await page.keyboard.press('Enter'); // the first Play of the score: the samples load first
    await expect(page.getByRole('button', { name: 'Pause' })).toBeFocused({ timeout: 5_000 });
    await expect(page.locator('.score-sheet .is-red').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Play' })).toBeFocused();
    // T10: the pause keeps the last group heard red; Play is plain.
    const paused = await expectOneRed(page, 'paused from the keyboard');
    expect(paused.every((r) => r.inSheet)).toBe(true);
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Pause' })).toBeFocused();
    await expectOneRed(page, 'playing again from the keyboard');
  });

  test('the dock keeps Pause on screen while the cursor scrolls through K.545, and Space pauses and plays', async ({
    page,
  }) => {
    await expectDockKeepsPause(page);
  });

  test('the red cursor never plays under the dock: the cursor scroll keeps every red note above it', async ({
    page,
  }) => {
    await expectCursorAboveDock(page);
  });

  test('the page turns once per screenful: still while the system is in view, then the next system at the top, fewer turns than centring (issue #5)', async ({
    page,
  }) => {
    await expectPageTurnsOncePerScreenful(page);
  });

  test('a loop typed while playing waits for the typing to settle before it moves the playhead', async ({
    page,
  }) => {
    await page.goto('/?audio=silent#/piece/twinkle-twinkle-little-star');
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
    await openPractice(page);
    await embellishDecided(page);
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    await page.getByRole('button', { name: 'Play' }).click();
    // Twinkle's bars last 2.4 s: wait until bar 3.
    await expect.poll(() => position(page), { timeout: 10_000 }).toBeGreaterThan(5);
    // "Loop bars" fills in the cursor's bar and the next (the playhead's own, so it stays); the
    // "to" field is emptied so the loop is typed from scratch, as a reader retyping it would.
    await page.getByRole('checkbox', { name: 'Loop bars' }).check();
    await page.getByLabel('Loop to bar').fill('');
    await page.getByLabel('Loop from bar').fill('1');
    const before = await position(page);
    // Bars 1 to 12 hold the playhead, but the first keystroke alone means bars 1 to 1.
    await page.getByLabel('Loop to bar').pressSequentially('12', { delay: 80 });
    await page.waitForTimeout(800);
    expect(await position(page)).toBeGreaterThan(before);
    // A loop that leaves the playhead outside still applies once the typing stops.
    await page.getByLabel('Loop to bar').fill('1');
    await expect.poll(() => position(page), { timeout: 3_000 }).toBeLessThan(2.4);
    await expectOneRed(page, 'looping bar 1');
  });

  // Polish plan Task 6, review S11: a reversed range (from 6, to 2) was ignored without a word.
  test('a loop whose "from" is after "to" says so and is not applied', async ({ page }) => {
    const REVERSED = 'The loop needs "from" before "to".';
    await page.goto('/?audio=silent#/piece/twinkle-twinkle-little-star');
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
    await openPractice(page);
    await embellishDecided(page);
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    const from = page.getByLabel('Loop from bar');
    const to = page.getByLabel('Loop to bar');
    await page.getByRole('checkbox', { name: 'Loop bars' }).check();
    await from.fill('6');
    await to.fill('2');
    const message = page.getByText(REVERSED, { exact: true });
    await expect(message).toBeVisible();
    for (const input of [from, to]) {
      await expect(input).toHaveAttribute('aria-invalid', 'true');
      await expect(input).toHaveAccessibleDescription(REVERSED);
    }
    let roots = await expectOneRed(page, 'a reversed loop');
    expect(roots[0]!.tag).toBe('button');
    await expectNoSeriousA11y(page, 'a reversed loop');

    // Not applied: Play starts at the first bar, not at bar 6 (12 s in, at ♩ = 100).
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.locator('.score-sheet .is-red').first()).toBeVisible({ timeout: 5_000 });
    expect(await position(page), 'playing from bar 1').toBeLessThan(2.4);

    // In order, the message goes and the loop applies: the playhead moves to bar 6 once the
    // typing settles (bars 6 to 8 are 12 to 19.2 s).
    await to.fill('8');
    await expect(message).toHaveCount(0);
    for (const input of [from, to]) await expect(input).not.toHaveAttribute('aria-invalid');
    await expect.poll(() => position(page), { timeout: 3_000 }).toBeGreaterThanOrEqual(12);
    expect(await position(page)).toBeLessThan(19.2);
    // The jump is a seek: Pause keeps the red until bar 6's first note is heard (Task 3).
    await expect(page.locator('.score-sheet .is-red').first()).toBeVisible({ timeout: 2_000 });
    roots = await expectOneRed(page, 'looping bars 6 to 8');
    expect(roots.every((r) => r.inSheet)).toBe(true);
  });

  // Polish plan Task 6, review S8: the tempo control read "70 %" next to the printed "♩ = 100",
  // and a tempo set for one piece carried to every other piece (and across reloads). It now says
  // the tempo it makes, and each piece keeps its own: a different piece opens at 100 %.
  test('the tempo says "70 % · ♩ = 70" for Twinkle at 70 % and plays at it; a different piece opens at 100 %', async ({
    page,
  }) => {
    const tempo = page.locator('.tempo-value');
    const slider = page.getByRole('slider', { name: 'Tempo' });
    /**
     * Plays from where the score is, waits for the first red note, and measures how fast the
     * score clock runs against the page's own clock over 1.5 s (1 at the written tempo); then
     * pauses.
     */
    const playRate = async (): Promise<number> => {
      await page.getByRole('button', { name: 'Play' }).click();
      await expect(page.locator('.score-sheet .is-red').first()).toBeVisible({ timeout: 5_000 });
      const rate = await page.evaluate(async () => {
        const hook = (window as unknown as { __digitus2: TestHook }).__digitus2;
        const p0 = hook.positionSec();
        const t0 = performance.now();
        await new Promise((r) => setTimeout(r, 1500));
        const p1 = hook.positionSec();
        const t1 = performance.now();
        return (p1 - p0) / ((t1 - t0) / 1000);
      });
      await page.getByRole('button', { name: 'Pause' }).click();
      await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
      return rate;
    };
    /** Back to the library, then the piece of that slug, ready to play. */
    const openFromLibrary = async (slug: string, title: string) => {
      await page.getByRole('button', { name: 'Back to the library' }).click();
      await openLibraryPiece(page, slug);
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      await expect(page.locator('.score-sheet g.fing').first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled();
    };

    await page.goto('/?audio=silent#/piece/twinkle-twinkle-little-star');
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
    await expect(tempo).toHaveText('100 % · ♩ = 100');
    await openPractice(page);
    await embellishDecided(page);
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    await slider.fill('70');
    await expect(tempo).toHaveText('70 % · ♩ = 70');
    await expect(slider).toHaveAttribute('aria-valuetext', '70 %, 70 quarter notes per minute');
    const slow = await playRate();
    expect(slow, `Twinkle at 70 %: score seconds per second ${slow}`).toBeGreaterThan(0.6);
    expect(slow, `Twinkle at 70 %: score seconds per second ${slow}`).toBeLessThan(0.8);

    // Ode to Joy (written at 108) opens at 100 %, and plays at it.
    await openFromLibrary('ode-to-joy', 'Ode to Joy');
    await expect(slider).toHaveValue('100');
    await expect(tempo).toHaveText('100 % · ♩ = 108');
    const full = await playRate();
    expect(full, `Ode to Joy at 100 %: score seconds per second ${full}`).toBeGreaterThan(0.9);
    expect(full, `Ode to Joy at 100 %: score seconds per second ${full}`).toBeLessThan(1.1);

    // Twinkle keeps its own 70 %, also after a reload.
    await openFromLibrary('twinkle-twinkle-little-star', 'Twinkle, Twinkle, Little Star');
    await expect(slider).toHaveValue('70');
    await expect(tempo).toHaveText('70 % · ♩ = 70');
    await page.reload();
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
    await expect(tempo).toHaveText('70 % · ♩ = 70');
    const roots = await expectOneRed(page, 'Twinkle at its own tempo');
    expect(roots[0]!.tag).toBe('button');
    await expectNoSeriousA11y(page, 'Twinkle at its own tempo');
  });

  // Issue #112: the saved Hands choice used to carry the empty hand into a one-hand piece, Play red
  // with nothing to play. Such a piece plays with both hands and offers no Hands control.
  test('a one-hand piece plays whatever hand is saved, with no Hands control, and the choice is kept', async ({
    page,
  }) => {
    await page.goto('/?audio=silent#/piece/twinkle-twinkle-little-star');
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
    await openPractice(page);
    await page.getByRole('radio', { name: 'Left hand' }).check();

    await page.goto('/?audio=silent');
    await page.getByLabel('Open your own score').setInputFiles({
      name: 'melody.musicxml',
      mimeType: 'application/xml',
      buffer: Buffer.from(melodyXml()),
    });
    const play = page.getByRole('button', { name: 'Play' });
    await expect(play).toBeEnabled({ timeout: 20_000 });
    await openPractice(page);
    await embellishDecided(page); // a file of up to 900 notes may be offered the switch
    await expect(page.getByRole('radio')).toHaveCount(0);
    await expect(page.getByRole('status')).toBeEmpty();
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    await play.click();
    await expect(page.locator('.score-sheet .is-red').first()).toBeVisible({ timeout: 5_000 });
    await expectOneRed(page, 'a one-hand piece playing');
    await page.getByRole('button', { name: 'Pause' }).click();

    // The saved choice is untouched: a piece with two hands opens with the left hand again.
    await page.goto('/?audio=silent#/piece/twinkle-twinkle-little-star');
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
    await openPractice(page);
    await expect(page.getByRole('radio', { name: 'Left hand' })).toBeChecked();
  });
});

test.describe('the keyboard on a phone', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('a wide piece keeps readable keys: the keyboard scrolls to the pressed keys, never the page', async ({
    page,
  }) => {
    await page.goto('/?audio=silent#/piece/mozart-sonata-k545-mvt1');
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(1288, { timeout: 20_000 });
    await openPractice(page);
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.locator('.score-sheet .is-red').first()).toBeVisible({ timeout: 5_000 });
    const white = await page.locator('.keyboard .key.is-white rect').first().boundingBox();
    expect(white!.width).toBeGreaterThanOrEqual(21.5);
    await expect(page.locator('.keyboard-scroll')).toHaveAttribute('tabindex', '0');
    for (let i = 0; i < 6; i++) {
      // Every pressed key is in view when they fit in the keyboard's width, else at least one.
      // Read at the start of a frame, as the reader sees it at the next paint.
      const view = await page.evaluate(async () => {
        await new Promise((r) => requestAnimationFrame(r));
        const box = document.querySelector('.keyboard-scroll')!.getBoundingClientRect();
        const keys = [...document.querySelectorAll('.keyboard .is-pressed rect')].map((r) =>
          r.getBoundingClientRect(),
        );
        const left = Math.min(...keys.map((k) => k.left));
        const right = Math.max(...keys.map((k) => k.right));
        const inView = keys.filter((k) => k.left >= box.left - 1 && k.right <= box.right + 1);
        return { pressed: keys.length, inView: inView.length, fits: right - left <= box.width };
      });
      expect(view.pressed, `sample ${i}`).toBeGreaterThan(0);
      expect(view.inView, `sample ${i}`).toBeGreaterThan(0);
      if (view.fits) expect(view.inView, `sample ${i}`).toBe(view.pressed);
      await page.waitForTimeout(250);
    }
    const overflow = await horizontalOverflow(page);
    expect(overflow).toBeLessThanOrEqual(0);
    await expectOneRed(page, 'playing on a phone');
    await expectNoSeriousA11y(page, 'playing on a phone');
  });
});

// Issue #14: on a wide window the score view stopped at 72rem, and a five-octave piece scrolled
// its keyboard with a third of the window empty. The view now grows with the window.
test.describe('the keyboard on a wide window', () => {
  test.use({ viewport: { width: 1716, height: 900 } });

  test('a five-octave piece shows every key without scrolling', async ({ page }) => {
    await page.goto('/?audio=silent#/piece/mozart-sonata-k545-mvt1');
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(1288, { timeout: 20_000 });
    const keyboard = page.locator('.keyboard-scroll');
    await expect(keyboard).not.toHaveAttribute('tabindex');
    const overflow = await keyboard.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

// The dock on a phone, where the review found Pause 5454 px above the viewport (the mobile
// project does not run this file, so the phone is emulated here).
test.describe('the dock on a phone', () => {
  test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });

  test('the dock keeps Pause on screen while the cursor scrolls through K.545, and Space pauses and plays', async ({
    page,
  }) => {
    await expectDockKeepsPause(page);
  });

  test('the red cursor never plays under the dock: the cursor scroll keeps every red note above it', async ({
    page,
  }) => {
    await expectCursorAboveDock(page);
  });

  // Polish plan Task 3: the count-in is shown where the reader is. Deep in a score the top of the
  // page is far away, so the status line sits in the dock, next to Pause.
  test('deep in the score the count-in counts in the dock, in view, and no note is red before it sounds', async ({
    page,
  }) => {
    const scrollY = () => page.evaluate(() => window.scrollY);
    await page.goto('/?audio=silent#/piece/mozart-sonata-k545-mvt1');
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(1288, { timeout: 20_000 });
    await openPractice(page);
    await expect(page.getByRole('checkbox', { name: 'Count-in' })).toBeChecked();
    // At 50 % K.545 counts in four beats of 0.91 s: time to check the count-in at leisure.
    await page.getByRole('slider', { name: 'Tempo' }).fill('50');
    await setLoopBars(page, '10', '11');
    const dock = page.locator('.dock');
    await dock.getByRole('button', { name: 'Play' }).click();
    // After the count-in the cursor scrolls the page down to bar 10, away from the top.
    await expect(page.locator('.score-sheet .is-red').first()).toBeInViewport({ timeout: 10_000 });
    await expect(page.locator('.dock .practice-toggle')).toBeInViewport();
    // Pause, back to the loop's first bar, and Play again: a new count-in, deep in the score.
    await dock.getByRole('button', { name: 'Pause' }).click();
    await dock.getByRole('button', { name: 'Rewind' }).click();
    const deep = await scrollY();
    expect(deep).toBeGreaterThan(0);
    await dock.getByRole('button', { name: 'Play' }).click();
    const status = page.getByRole('status');
    await expect(status).toHaveText(/^[1-4]$/);
    await expect(page.locator('.score-sheet .is-red')).toHaveCount(0);
    await expect(page.locator('.keyboard .is-pressed')).toHaveCount(0);
    const counting = await expectOneRed(page, 'count-in deep in the score');
    expect(counting[0]!.tag).toBe('button');
    await expect(dock.getByRole('status')).toHaveCount(1);
    await expect(status).toBeInViewport({ ratio: 1 });
    expect(await scrollY(), 'the count-in left the page where it was').toBe(deep);
    // The music starts: bar 10's first notes turn red, and the count goes.
    await expect(page.locator('.score-sheet .is-red').first()).toBeInViewport({ timeout: 5_000 });
    await expect(status).toBeEmpty();
    const roots = await expectOneRed(page, 'playing after the count-in deep in the score');
    expect(roots.every((r) => r.inSheet)).toBe(true);
  });

  // Polish plan, Review Focus 2: the scroll to the top when a view replaces another must not
  // fight the cursor's own scroll while the score plays.
  test('playback scroll still follows the cursor after a view change', async ({ page }) => {
    const scrollY = () => page.evaluate(() => window.scrollY);
    await page.goto('/?audio=silent');
    await libraryReady(page);
    const row = await showPiece(page, 'mozart-sonata-k545-mvt1');
    // The view change: K.545 opened from far down its shelf.
    // The row near the top of the screen, well below the start of the page.
    await row.evaluate((el) =>
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 80),
    );
    expect(await scrollY()).toBeGreaterThan(100);
    await row.click();
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(1288, { timeout: 20_000 });
    expect(await scrollY(), 'the score opens at the top').toBe(0);

    // Count-in off and 150 %, so the cursor reaches the systems below the first screen within
    // 3 s. The practice controls are above the score, so the page stays at the top; Play starts
    // from there (a click in the dock does not scroll the page: only the cursor may, here).
    await openPractice(page);
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    await page.getByRole('slider', { name: 'Tempo' }).fill('150');
    expect(await scrollY()).toBe(0);
    await page.locator('.dock').getByRole('button', { name: 'Play' }).click();
    await expect(page.locator('.score-sheet .is-red').first()).toBeVisible({ timeout: 5_000 });

    // Over 3 s the cursor scrolls the page down after the music, and nothing pulls it back.
    const ys: number[] = [];
    for (let i = 0; i < 30; i++) {
      ys.push(await scrollY());
      await page.waitForTimeout(100);
    }
    const samples = `scrollY every 100 ms: ${ys.join(', ')}`;
    expect(ys[ys.length - 1]!, samples).toBeGreaterThan(ys[0]!);
    for (let i = 1; i < ys.length; i++) expect(ys[i]!, samples).toBeGreaterThanOrEqual(ys[i - 1]!);
    await expect(page.getByRole('button', { name: 'Pause' })).toBeInViewport({ ratio: 1 });
    const roots = await expectOneRed(page, 'playing after a view change');
    expect(roots.every((r) => r.inSheet)).toBe(true);
  });
});

/** One marked note group of the playing cursor, and the accent drawn for it. */
interface CursorMark extends AccentArea {
  /** The box of the group's noteheads, stems and flags as engraved (viewport pixels). */
  parts: Box;
  /** The area of one of its noteheads as engraved (width times height, square pixels). */
  head: number;
  stem: boolean;
}

/** The page's own animation frames, held while a look is taken (`holdFrames`). */
interface HeldFrames {
  __frames?: {
    request: typeof requestAnimationFrame;
    cancel: typeof cancelAnimationFrame;
    held: Map<number, FrameRequestCallback>;
  };
}

/**
 * Holds the page's animation frames, so the cursor's loop (useCursor.ts, one frame at a time)
 * stays on the onset it marks while a screenshot is taken: a look with the trace's DOM snapshots
 * of K.545 outlasts a sixteenth note. The music plays on; `releaseFrames` lets the loop catch up.
 * A held frame keeps an id of its own, so the loop's cleanup can still cancel it.
 */
async function holdFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const w = window as unknown as HeldFrames;
        const request = window.requestAnimationFrame.bind(window);
        const cancel = window.cancelAnimationFrame.bind(window);
        const held = new Map<number, FrameRequestCallback>();
        let next = 1e9;
        w.__frames = { request, cancel, held };
        window.requestAnimationFrame = (cb) => {
          held.set(++next, cb);
          return next;
        };
        window.cancelAnimationFrame = (id) => {
          if (!held.delete(id)) cancel(id);
        };
        // The frame the loop has already asked for runs once more and asks again: held.
        request(() => request(() => resolve()));
      }),
  );
}

async function releaseFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as HeldFrames;
    const frames = w.__frames;
    if (!frames) return;
    delete w.__frames;
    window.requestAnimationFrame = frames.request;
    window.cancelAnimationFrame = frames.cancel;
    // Run the held frames now: each asks again for a real frame, with an id its cleanup can cancel.
    for (const cb of frames.held.values()) cb(performance.now());
  });
}

/**
 * One look at the playing cursor, its frames held: its marked note groups, a screenshot around
 * them, and the accent's pixels drawn for each. Null (look again) when nothing is marked, a mark
 * is not wholly on screen above the dock, or the marks or the page moved during the look.
 */
async function lookAtCursor(page: Page): Promise<{ tick: string; marks: CursorMark[] } | null> {
  await holdFrames(page);
  try {
    return await lookAtHeldCursor(page);
  } finally {
    await releaseFrames(page);
  }
}

async function lookAtHeldCursor(page: Page): Promise<{ tick: string; marks: CursorMark[] } | null> {
  const before = await page.evaluate(() => {
    const union = (rects: DOMRect[]) => ({
      left: Math.min(...rects.map((r) => r.left)),
      top: Math.min(...rects.map((r) => r.top)),
      right: Math.max(...rects.map((r) => r.right)),
      bottom: Math.max(...rects.map((r) => r.bottom)),
    });
    const reds = [...document.querySelectorAll('.score-sheet .is-red')];
    return {
      tick: reds[0]?.getAttribute('data-onset-tick') ?? null,
      scrollY: window.scrollY,
      dockTop: document.querySelector('.dock')!.getBoundingClientRect().top,
      marks: reds.map((el) => {
        const headEl = el.querySelector('.notehead')!;
        const head = headEl.getBoundingClientRect();
        // The cursor draws the head larger (base.css, a CSS scale); the area wanted is as engraved.
        const scale = new DOMMatrix(getComputedStyle(headEl).transform);
        const parts = [...el.querySelectorAll('.notehead, .stem, .flag')];
        return {
          parts: union(parts.map((p) => p.getBoundingClientRect())),
          head: (head.width / scale.a) * (head.height / scale.d),
          stem: el.querySelector('.stem') !== null,
        };
      }),
    };
  });
  const tick = before.tick;
  if (tick === null || before.marks.length === 0) return null;
  const width = page.viewportSize()!.width;
  const all = {
    left: Math.min(...before.marks.map((m) => m.parts.left)),
    top: Math.min(...before.marks.map((m) => m.parts.top)),
    right: Math.max(...before.marks.map((m) => m.parts.right)),
    bottom: Math.max(...before.marks.map((m) => m.parts.bottom)),
  };
  const margin = 6;
  if (all.left < margin || all.top < margin || all.right > width - margin) return null;
  if (all.bottom > before.dockTop - margin) return null;
  const x = Math.floor(all.left - margin);
  const y = Math.floor(all.top - margin);
  const clip = {
    x,
    y,
    width: Math.ceil(all.right + margin) - x,
    height: Math.ceil(all.bottom + margin) - y,
  };
  const png = await page.screenshot({ clip });
  const after = await page.evaluate(() => ({
    tick: document.querySelector('.score-sheet .is-red')?.getAttribute('data-onset-tick') ?? null,
    scrollY: window.scrollY,
  }));
  if (after.tick !== tick || after.scrollY !== before.scrollY) return null;
  const grown = before.marks.map((m) => ({
    left: m.parts.left - 4,
    top: m.parts.top - 4,
    right: m.parts.right + 4,
    bottom: m.parts.bottom + 4,
  }));
  const areas = await accentAreas(page, png, clip, grown);
  return { tick, marks: before.marks.map((m, i) => ({ ...m, ...areas[i]! })) };
}

// Polish plan Task 4 and Review Focus 4 (review S5): the cursor was the red notehead alone, 9 x
// 8 px (46 red pixels in the review's 360 px screenshot of K.545), easy to lose in a run of
// sixteenths; the stem, 0.7 px wide, drew no pixel of the red itself. The cursor is now the
// current notes drawn bold (the notehead at 1.4 times its size, the stem 3 px wide, the flag at 1.3), and
// still nothing but the notes of one onset.
test.describe('the cursor on a phone', () => {
  test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });

  test('the cursor draws its notes bold: the red covers the stem and four noteheads', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' }); // the cursor's page scroll lands at once
    await page.goto('/?audio=silent#/piece/mozart-sonata-k545-mvt1');
    await expect(page.locator('.score-sheet g.fing')).toHaveCount(1288, { timeout: 20_000 });
    await openPractice(page);
    await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
    // The review's run of sixteenths, at half speed (each look holds the cursor still anyway).
    await page.getByRole('slider', { name: 'Tempo' }).fill('50');
    await setLoopBars(page, '30', '31');
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.locator('.score-sheet .is-red').first()).toBeInViewport({ timeout: 10_000 });

    // Ten onsets, each looked at once.
    const looks: { tick: string; marks: CursorMark[] }[] = [];
    for (let tries = 0; looks.length < 10 && tries < 80; tries++) {
      const look = await lookAtCursor(page);
      if (look && !looks.some((l) => l.tick === look.tick)) looks.push(look);
      else await page.waitForTimeout(60);
    }
    expect(looks).toHaveLength(10);
    const boxes: number[] = [];
    const counts: number[] = [];
    for (const look of looks) {
      const stemmed = look.marks.filter((m) => m.stem);
      expect(stemmed.length, `onset ${look.tick}`).toBeGreaterThan(0);
      for (const m of stemmed) {
        const at = `onset ${look.tick}: ${JSON.stringify(m)}`;
        expect(m.box, at).not.toBeNull();
        const box = m.box!;
        // The red covers the note as engraved, stem and flag included, not just the notehead. The
        // box holds only pixels at least 91 % red (accentAreas), so an edge falls short of the
        // shapes' geometry: by the part of a pixel the edge covers, and on the bold head's curved
        // far side by about a pixel more (1.81 px at an onset of K.545 that failed 1 run in 4
        // with 1.5 px; issue #114). A cursor that left out the stem would miss by its length.
        const EDGE = 2;
        expect(box.left, at).toBeLessThanOrEqual(m.parts.left + EDGE);
        expect(box.top, at).toBeLessThanOrEqual(m.parts.top + EDGE);
        expect(box.right, at).toBeGreaterThanOrEqual(m.parts.right - EDGE);
        expect(box.bottom, at).toBeGreaterThanOrEqual(m.parts.bottom - EDGE);
        // It spans at least four times the area of a notehead (the old cursor: less than one)...
        const area = (box.right - box.left) * (box.bottom - box.top);
        expect(area, at).toBeGreaterThanOrEqual(4 * m.head);
        // ...and is solid: at least one and a half noteheads of the red (the old cursor: 0.6).
        expect(m.count, at).toBeGreaterThanOrEqual(1.5 * m.head);
        boxes.push(area / m.head);
        counts.push(m.count / m.head);
      }
    }
    const range = (v: number[]) => `${Math.min(...v).toFixed(2)} to ${Math.max(...v).toFixed(2)}`;
    test
      .info()
      .annotations.push(
        { type: 'red box per stemmed note / notehead area', description: range(boxes) },
        { type: 'red pixels per stemmed note / notehead area', description: range(counts) },
      );
    const roots = await expectOneRed(page, 'the bold cursor on a phone');
    expect(roots.every((r) => r.inSheet && /\b(note|chord)\b/.test(r.className))).toBe(true);
    await expectNoSeriousA11y(page, 'the bold cursor on a phone');
  });
});
