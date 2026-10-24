import type { Note } from '@digitus2/engine';
import { ornamentAttacks } from '@digitus2/engine/ornaments';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { messageOf } from '../app/errors.js';
import { useAppStore, type HandsMode, type PieceSource } from '../app/store.js';
import { Button } from '../design/Button.js';
import { Loader, type LoaderTune } from '../design/Loader.js';
import { NARROW_QUERY, TOUCH_QUERY, useMediaQuery } from '../design/media.js';
import { flash, prefersReducedMotion } from '../design/motion.js';
import { messages, useT } from '../i18n/i18n.js';
import type { Messages } from '../i18n/messages.js';
import { useLibraryPiece } from '../library/useLibraryPiece.js';
import { BarSeek, type BarSeekHandle } from './BarSeek.js';
import { barIndexAt, barStartSecs, clampBar, seekKey } from './bars.js';
import { useEmbellishCarry } from './carry.js';
import { letteredBars, lettersShown } from './handLetters.js';
import { keyboardRange } from './Keyboard.js';
import { handOfKey, keyForNote } from './noteKey.js';
import { buildOnsetGroups, hasNotesFor } from './onsetGroups.js';
import { PianoKeyboard } from './PianoKeyboard.js';
import { EndBurst } from './EndBurst.js';
import { RedGhost, useRedFlight } from './RedFlight.js';
import {
  mutedElements,
  redim,
  setDigits,
  settleCancelled,
  settleStill,
  settleSweep,
  sweepDimming,
  systemsOnScreen,
} from './render/dom.js';
import { quietPlaces } from './render/pageIndex.js';
import { pageWindowOf } from './render/pageWindow.js';
import { clearTimingMarks, drawTimingMarks, type TimingMark } from './render/timingMarks.js';
import { ScoreHeader, useLegendAbove } from './ScoreHeader.js';
import { ScoreSheet } from './ScoreSheet.js';
import { SidePanel } from './SidePanel.js';
import { PracticeControls, startQpm, Transport } from './Transport.js';
import { useCursor } from './useCursor.js';
import { useHoveredNote } from './useHoveredNote.js';
import { usePlayAlong, type AlongHint } from './usePlayAlong.js';
import { handsFor, mutedHandsFor, oneHanded, usePlayback, type CountIn } from './usePlayback.js';
import { useScoreDocument, type DocStatus, type ScoreDocument } from './useScoreDocument.js';
import { useTimingRun, type TimingSummary } from './useTimingRun.js';

/** The status line's text while the score is busy, by status. */
/** No keys to follow: nothing is marked. */
const NO_BAR_KEYS: number[] = [];

function busyText(status: DocStatus, t: Messages): string | undefined {
  const text = t.score.view.status;
  if (status === 'idle' || status === 'loading') return text.loading;
  if (status === 'fingering') return text.fingering;
  if (status === 'rendering') return text.rendering;
  return undefined;
}

/**
 * What the loader plays while the score is busy and there is no music to show yet (Loader.tsx):
 * the scale while it loads, the scale with its fingering while the engine fingers, chords while
 * it is laid out. Null once the score is ready, and while a busy score keeps its pages on screen
 * (the same piece opened again).
 */
export function loaderTune(status: DocStatus, pageCount: number): LoaderTune | null {
  if (pageCount > 0) return null;
  if (status === 'idle' || status === 'loading') return 'scale';
  if (status === 'fingering') return 'fingering';
  if (status === 'rendering') return 'chords';
  return null;
}

/** How long a hand switch takes to sweep from the first bar of a system to the last (ms). */
export const HAND_SWEEP_MS = 140;

/**
 * Whether the pages on screen carry the editor's fingering: the assignment they show is the
 * editorial one itself. It follows the pages, not the setting, which persists across pieces and
 * lands a layout later: with the setting on, a piece without an editor's fingering shows the
 * engine's digits, and while a switch is being laid out the old digits are still on screen
 * (review S12: going from the engine's 254 digits to the editor's 27 looked like a bug when
 * nothing said whose digits these are).
 */
export function showsEditorial(doc: Pick<ScoreDocument, 'assignment' | 'editorial'>): boolean {
  return doc.assignment !== null && doc.assignment === doc.editorial;
}

/** The status line when the selected hands have no notes in this piece. */
function nothingToPlayText(hands: HandsMode, t: Messages): string {
  if (hands === 'L') return t.score.view.noNotesLeft;
  if (hands === 'R') return t.score.view.noNotesRight;
  return t.score.view.noNotes;
}

/** What the status line is made from. */
export interface StatusInputs {
  docStatus: DocStatus;
  /** Whether the selected hands have notes in this piece. */
  playable: boolean;
  hands: HandsMode;
  /**
   * The player is fetching the piano's samples: after the first Play, or for the other hand of
   * the play-along (issue 184).
   */
  loading: boolean;
  countIn: CountIn | null;
  /**
   * The red waits for the reader's piano (issue 182): what to ask of them and how many pitches
   * the step in front of them has (`play`, or `hold` after a release that came too early, issue
   * 185), or null when the hint is not shown (usePlayAlong).
   */
  alongHint: AlongHint | null;
  /**
   * The browser waits for a click before digitus can sound the other hand (issue 184): what the
   * sentence asks for ('tap' on a touch screen), or null when it is not shown (usePlayAlong).
   */
  alongSound: 'click' | 'tap' | null;
  /**
   * How the timing went in the last run of Play with the piano (issue 192), while the summary
   * keeps the line (`summaryLifetime`); null or left out when none is shown.
   */
  timing?: TimingSummary | null;
}

/**
 * The summary's life on the status line (issue 192). It shows when a judgement arrives and leaves
 * for good at the first of: a line above it taking the line, the transport playing, or the red
 * moving while stopped (a walk pass or a seek), seen as `currentGroup` changing from the group the
 * red settled on with the summary. Settled means a group is marked and no flight home is on screen:
 * after the piece's end the red flies home and the walk cues the first step a frame later, and
 * that landing is not a move. A group of -1 is never a move.
 */
export interface SummaryLife {
  /** The summary this life follows (the last one seen); null when there is none. */
  summary: TimingSummary | null;
  /** The summary object on the line, or null once it has left. */
  shown: TimingSummary | null;
  /** The red's group once settled with the summary; null while it waits to settle. */
  baseline: number | null;
}

export const NO_SUMMARY_LIFE: SummaryLife = { summary: null, shown: null, baseline: null };

/**
 * The next `SummaryLife`, from the latest render's inputs. Returns `prev` itself when nothing
 * changes, and the same answer when fed the same input twice.
 */
export function summaryLifetime(
  prev: SummaryLife,
  input: {
    summary: TimingSummary | null;
    /** A line above the summary would show (busy, nothing to play, loading, count-in, sound, hold). */
    higherLine: boolean;
    currentGroup: number;
    playing: boolean;
    /** The red is flying home (after the end, or Rewind). */
    flyingHome: boolean;
  },
): SummaryLife {
  const { summary, currentGroup } = input;
  if (summary === null) return prev.summary === null ? prev : NO_SUMMARY_LIFE;
  const life = summary === prev.summary ? prev : { summary, shown: summary, baseline: null };
  if (life.shown === null) return life;
  if (input.playing || input.higherLine) return { ...life, shown: null };
  if (currentGroup < 0 || input.flyingHome) return life;
  if (life.baseline === null) return { ...life, baseline: currentGroup };
  return currentGroup === life.baseline ? life : { ...life, shown: null };
}

/** The timing summary's sentence (issue 192). */
function timingText(timing: TimingSummary, t: Messages): string {
  const view = t.score.view;
  if (timing.onTime < timing.total) return view.timingSummary(timing.onTime, timing.total);
  return timing.belowFullTempo ? view.timingAllOnTimeFaster : view.timingAllOnTime;
}

/**
 * What the status line says: its text, and its kind. A `count` is a beat of the count-in, the cue
 * to get ready (set large, in ink); every other line is `info` (secondary, in gray).
 */
export interface StatusLine {
  text: string;
  kind: 'count' | 'info';
}

/**
 * The status line: what the score is busy with (loading, fingering, laying out), else why Play is
 * unavailable (no notes in the selected hand), else what the player is busy with: loading the
 * piano (after the first Play, or for the other hand), then the count-in, each click's beat in its bar ("1", "2", "3",
 * "4"; "1", "2" before a 3/4 pickup that enters on 3; "1" to "4" then "1" when a whole bar comes
 * before a pickup), then, lowest of all, what the play-along asks of the reader: one click for
 * the browser to let digitus sound the other hand (issue 184), then what to play on their piano
 * while the red waits (issue 182). The timing summary after a run (issue 192) comes after the
 * walk's `hold` hint and before its `play` hint: after a Pause the first-step hint returns and
 * would hide the result. Null when there is nothing to say (a ready score, stopped or playing the
 * music). Written in `t` (default: the language on screen).
 */
export function scoreStatusLine(
  { docStatus, playable, hands, loading, countIn, alongHint, alongSound, timing }: StatusInputs,
  t: Messages = messages(),
): StatusLine | null {
  const info = (text: string): StatusLine => ({ text, kind: 'info' });
  if (docStatus !== 'ready') {
    const text = busyText(docStatus, t);
    return text === undefined ? null : info(text);
  }
  if (!playable) return info(nothingToPlayText(hands, t));
  if (loading) return info(t.score.view.loadingPiano);
  if (countIn) return { text: String(countIn.beatInBar), kind: 'count' };
  if (alongSound !== null) return info(t.score.view.playAlongSound[alongSound]);
  if (alongHint?.kind === 'hold') return info(t.score.view.holdLonger(alongHint.count));
  if (timing) return info(timingText(timing, t));
  if (alongHint !== null) return info(t.score.view.playAlongHint(alongHint.count));
  return null;
}

/** The status line's class: hidden when it is empty, so it takes no room in the dock. */
function statusClass(status: StatusLine | null): string {
  if (status === null) return 'score-status visually-hidden';
  return status.kind === 'count' ? 'score-status is-count' : 'score-status muted';
}

/**
 * The content width of an element, measured before the first paint and kept current with a
 * ResizeObserver. Returns a callback ref and the width (0 until measured).
 */
function useElementWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return [setEl, width];
}

/**
 * Publishes the dock's height on the root element as `--dock-h`, which is the page's bottom
 * scroll padding (base.css): what scrolling brings into view (the cursor's system, a focused
 * control) then stops above the dock instead of behind it. Measured before the first paint and
 * kept current with a ResizeObserver (the keyboard arrives with the score, and the dock rewraps
 * when the width changes); removed when the dock goes. Returns a callback ref for the dock.
 */
function useDockHeight<T extends HTMLElement>(): (el: T | null) => void {
  const [el, setEl] = useState<T | null>(null);
  useLayoutEffect(() => {
    if (!el) return;
    const root = document.documentElement;
    const measure = () =>
      root.style.setProperty('--dock-h', `${el.getBoundingClientRect().height}px`);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      root.style.removeProperty('--dock-h');
    };
  }, [el]);
  return setEl;
}

export function ScoreView({ source }: { source: PieceSource }) {
  const t = useT();
  const openLibrary = useAppStore((s) => s.openLibrary);
  const [measureRef, width] = useElementWidth<HTMLElement>();
  const dockHeightRef = useDockHeight<HTMLDivElement>();
  // The dock is also where the red's flights start and end (Play, RedFlight.tsx).
  const [dock, setDock] = useState<HTMLDivElement | null>(null);
  const dockRef = useCallback(
    (el: HTMLDivElement | null) => {
      dockHeightRef(el);
      setDock(el);
    },
    [dockHeightRef],
  );
  const doc = useScoreDocument(source, width);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  // The finger legend under the header until the first Play (spec 12), decided once for the view
  // and handed to the side panel too, so the legend shows once on a screen.
  const legendAbove = useLegendAbove();
  // Below 480 px the Practice toggle sits after Rewind (spec 13): it is rendered there, so the
  // DOM order, and with it the tab order, is the order on screen at every width.
  const narrow = useMediaQuery(NARROW_QUERY);
  // The sentence that asks for one click says tap on a screen nothing hovers on (issue 184).
  const touch = useMediaQuery(TOUCH_QUERY);

  // A re-solve publishes only the digits that changed: patch them into the pages in place. Only
  // some pages are in the DOM on a long piece (issue 99), so the digits patched since the layout
  // are kept, and written into each page as it is built (`decorate`). A new layout starts them
  // afresh; the same changes never flash twice.
  const patchesRef = useRef<{ pages: string[]; map: Map<string, string> }>({
    pages: doc.pages,
    map: new Map(),
  });
  const flashedRef = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (patchesRef.current.pages !== doc.pages) {
      patchesRef.current = { pages: doc.pages, map: new Map() };
    }
    const changes = doc.digitChanges;
    if (!host || !changes || flashedRef.current === changes) return;
    flashedRef.current = changes;
    for (const [id, digit] of changes) patchesRef.current.map.set(id, digit);
    setDigits(host, changes, flash);
  }, [host, doc.digitChanges, doc.pages]);

  // Playback, the cursor and the keyboard. An error stops playback (the score is gone).
  const score = doc.status === 'error' ? null : doc.score;
  const playback = usePlayback(score);
  const hands = handsFor(
    score,
    useAppStore((s) => s.settings.hands),
  );
  const mutedHands = useMemo(() => mutedHandsFor(hands), [hands]);
  const groups = useMemo(() => (score ? buildOnsetGroups(score) : []), [score]);
  const range = useMemo(() => (score ? keyboardRange(score) : null), [score]);
  // One-hand practice: the hand left out is dimmed in the score as on the keyboard (review S10).
  // A layout effect after the pages are in (ScoreSheet writes them in one too), so a hand switch
  // dims and the cursor re-marks in the same paint, and new pages arrive already dimmed. One set of
  // note ids per selection and score, so switching back finds the same set (and its elements below).
  const mutedIdsBy = useMemo(() => {
    const leftOut = (h: HandsMode) =>
      new Set(score?.notes.filter((n) => mutedHandsFor(h).includes(n.hand)).map((n) => n.id));
    return { both: leftOut('both'), L: leftOut('L'), R: leftOut('R') };
  }, [score]);
  const mutedIds = mutedIdsBy[hands];
  // What a page built later needs to look like the pages built with the layout (issue 99): the
  // dimming of the hand left out, with the whole-staff rule decided across every page's markup
  // (`quietPlaces`), and the digits patched since. A layout effect above everything that reads the
  // pages, so a cursor that brings a page in finds it set.
  const decorRef = useRef<{
    pages: string[];
    mutedIds: ReadonlySet<string>;
    quiet: ReadonlySet<number> | undefined;
  } | null>(null);
  useLayoutEffect(() => {
    const index = host ? pageWindowOf(host)?.index : undefined;
    decorRef.current = {
      pages: doc.pages,
      mutedIds,
      quiet: index ? quietPlaces(index, mutedIds) : undefined,
    };
  }, [host, doc.pages, mutedIds]);
  // The timing rings of the last run (issue 192), for a page built later: a torn page is rebuilt
  // from markup, without them. Set with the rings' own layout effect below.
  const timingMarksRef = useRef<readonly TimingMark[] | null>(null);
  const decorate = useCallback((page: SVGSVGElement, i: number) => {
    const d = decorRef.current;
    const patches = patchesRef.current;
    const index = page.parentElement ? pageWindowOf(page.parentElement)?.index : undefined;
    if (!d) return;
    if (index && patches.pages === d.pages && patches.map.size > 0) {
      const own = new Map([...patches.map].filter(([id]) => index.pageOfNote.get(id) === i));
      if (own.size > 0) setDigits(page, own);
    }
    redim([], mutedElements(page, d.mutedIds, d.quiet));
    const marks = timingMarksRef.current;
    if (marks) {
      clearTimingMarks(page);
      drawTimingMarks(page, marks);
    }
  }, []);
  // A hand switch on the same pages fades the hand left out (or back in) bar by bar, from the first
  // bar of each system to the last (`sweepDimming`), in the systems on screen; the rest of the
  // piece, and new pages, change at once. The systems are found before any class changes, while
  // the layout is clean. What a selection dims is found over the pages in the DOM (`mutedElements`);
  // a page built later is dimmed as it arrives (`decorate`).
  const dimmedRef = useRef<{ host: Element; pages: string[] } | null>(null);
  useLayoutEffect(() => {
    if (!host) return;
    const last = dimmedRef.current;
    const switched = last !== null && last.host === host && last.pages === doc.pages;
    const shown = mutedElements(host, mutedIds, decorRef.current?.quiet);
    const spread = prefersReducedMotion() ? 0 : HAND_SWEEP_MS;
    const onScreen = switched && spread > 0 ? systemsOnScreen(host) : new Set<Element>();
    // New pages arrive with nothing dimmed.
    const before = switched ? [...host.querySelectorAll('.is-muted')] : [];
    redim(before, shown);
    dimmedRef.current = { host, pages: doc.pages };
    if (!switched) return;
    if (sweepDimming(host, new Set([...before, ...shown]), spread, onScreen) > 0) settleStill(host);
  }, [host, doc.pages, mutedIds]);
  // Each element swept settles into its resting look when its own fade ends (`settleSweep`), or
  // when a switch cancelled it and nothing of it still runs (`settleCancelled`).
  useEffect(() => {
    if (!host) return;
    const settle = (e: Event) => settleSweep(e.target);
    const cancelled = (e: Event) => settleCancelled(e.target);
    host.addEventListener('transitionend', settle);
    host.addEventListener('animationend', settle);
    host.addEventListener('transitioncancel', cancelled);
    host.addEventListener('animationcancel', cancelled);
    return () => {
      host.removeEventListener('transitionend', settle);
      host.removeEventListener('animationend', settle);
      host.removeEventListener('transitioncancel', cancelled);
      host.removeEventListener('animationcancel', cancelled);
    };
  }, [host]);
  const { pressed, muted, currentGroup, struckCount } = useCursor({
    host,
    groups,
    playback,
    assignment: doc.assignment,
    mutedHands,
    layoutKey: doc.pages,
  });
  // The red travels between Play and the cursor instead of jumping (RedFlight.tsx). Called after
  // useCursor, so its layout effects see the marks the cursor has just made or cleared.
  const playButton = useCallback(
    () => dock?.querySelector<HTMLElement>('.play-button') ?? null,
    [dock],
  );
  const red = useRedFlight({ host, playButton, playback, groups, mutedHands, currentGroup });
  // T11: the hand letters show only in bars where the hands come within a fifth. Decided from
  // the full groups (both hands, whatever is muted), never from the cursor's filtered ones.
  const lettered = useMemo(() => letteredBars(groups), [groups]);
  // The bar the cursor is in (1-based; 1 when nothing is marked): where "Loop bars" starts.
  const currentBar =
    currentGroup >= 0 ? (groups[currentGroup]?.notes[0]?.measureIndex ?? 0) + 1 : 1;
  // The keys the played hands strike in the cursor's bar, one per attack: a keyboard that scrolls
  // chooses its view from these, once a bar (issue 104). None while nothing is marked.
  const marked = currentGroup >= 0;
  const notesByBar = useMemo(() => {
    const byBar = new Map<number, Note[]>();
    for (const n of score?.notes ?? []) {
      const bar = byBar.get(n.measureIndex);
      if (bar) bar.push(n);
      else byBar.set(n.measureIndex, [n]);
    }
    return byBar;
  }, [score]);
  const barKeys = useMemo(
    () =>
      marked
        ? (notesByBar.get(currentBar - 1) ?? [])
            .filter((n) => !mutedHands.includes(n.hand))
            .flatMap((n) => ornamentAttacks(n).map((a) => a.midi))
        : NO_BAR_KEYS,
    [notesByBar, currentBar, marked, mutedHands],
  );
  // The dock's Practice panel: open or closed for the visit (store), closed on every page load.
  const practiceOpen = useAppStore((s) => s.practiceOpen);
  const setPracticeOpen = useAppStore((s) => s.setPracticeOpen);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  // A selection with no notes (a one-hand piece, the other hand chosen) has nothing to hear and
  // nothing for the cursor to mark: Play stays the red element, unavailable, and a running
  // playback stops.
  const playable = useMemo(() => hasNotesFor(groups, mutedHands), [groups, mutedHands]);
  const { playing, pause } = playback;
  useEffect(() => {
    if (playing && !playable) pause();
  }, [playing, playable, pause]);

  // The keyboard answers (issue #96). Stopped or paused, the key of the note under the mouse
  // pointer goes down with its finger (useHoveredNote.ts); a key pressed on the keyboard sounds
  // at its hand's unmarked velocity (playback.strike), whatever the transport is doing. The notes
  // move with new pages and with the width (as the bars do, `barLayout` below).
  const noteLayout = useMemo(() => ({ pages: doc.pages, width }), [doc.pages, width]);
  const hoveredId = useHoveredNote({
    host,
    layoutKey: noteLayout,
    enabled: doc.status === 'ready' && !playback.playing,
  });
  const noteById = useMemo(() => new Map(score?.notes.map((n) => [n.id, n])), [score]);
  const hoveredNote = hoveredId === null ? undefined : noteById.get(hoveredId);
  const hoveredKey = useMemo(
    () => (hoveredNote ? keyForNote(hoveredNote, doc.assignment) : null),
    [hoveredNote, doc.assignment],
  );
  const { strike } = playback;
  const strikeKey = useCallback(
    (midi: number) => (score ? strike(midi, handOfKey(score, midi)) : undefined),
    [score, strike],
  );

  // T13: the score is the timeline. A click or tap in a bar, or Left and Right (Shift: four bars),
  // goes to a bar's start; the red hops there (RedFlight.tsx) and, playing, the music comes in as
  // it lands. Seeks stay inside a loop. Home is Rewind.
  const barStarts = useMemo(() => (score ? barStartSecs(score) : []), [score]);
  const seekable = doc.status === 'ready' && playable && barStarts.length > 0;
  const barSeekRef = useRef<BarSeekHandle>(null);
  // The bars move with new pages and with the width (the pages scale within a layout's width).
  const barLayout = useMemo(() => ({ pages: doc.pages, width }), [doc.pages, width]);
  const loop = playback.loop;
  const canSeek = useCallback(
    (bar: number) => seekable && (!loop || (bar >= loop.from && bar <= loop.to)),
    [seekable, loop],
  );

  // "Add notes between" (issue #67). The switch swaps the score, which halts playback and drops
  // the loop (usePlayback.ts): the bar, the loop and the play state are recorded and put back
  // once the version asked for is on screen (carry.ts). Called after usePlayback, so its halt
  // for the new score has run first.
  const toggleEmbellish = useEmbellishCarry(doc, score, playback, barStarts);

  // Playing along on the reader's own piano (issue 182): while one is connected and the score is
  // stopped, the red waits on the next step to play and moves on when the reader plays it. Called
  // after the carry above and after the cursor and the flights, so its passive align effect runs
  // after theirs in the same commit (usePlayAlong.ts).
  const along = usePlayAlong({
    score,
    ready: doc.status === 'ready',
    playable,
    playback,
    mutedHands,
    currentGroup,
    flightShown: red.redAway,
  });

  // How the timing went in a run of Play with the piano (issue 192): gray rings at the notes that
  // came clearly early, late or not at all, drawn after the run stops and kept until the next
  // Play, on new pages too (`decorate`); and one line, which keeps the status line only until
  // something else needs it (`summaryLifetime`, set during the render below).
  const timing = useTimingRun({
    score,
    ready: doc.status === 'ready',
    playable,
    playback,
    mutedHands,
  });
  useLayoutEffect(() => {
    timingMarksRef.current = timing.marks;
    if (!host) return;
    clearTimingMarks(host);
    if (timing.marks) drawTimingMarks(host, timing.marks);
  }, [host, doc.pages, timing.marks]);
  const [summaryLife, setSummaryLife] = useState<SummaryLife>(NO_SUMMARY_LIFE);

  // The Practice mode switch (issue 191): in the Practice panel only while a piano is connected.
  // The prop is memoised on the two booleans, so a MIDI message never renders the panel.
  const practiceOn = useAppStore((s) => s.settings.practiceMode);
  const setSettings = useAppStore((s) => s.setSettings);
  const practiceMode = useMemo(
    () =>
      along.pianoConnected
        ? { on: practiceOn, set: (on: boolean) => setSettings({ practiceMode: on }) }
        : null,
    [along.pianoConnected, practiceOn, setSettings],
  );

  const seekToBar = useCallback(
    (bar: number) => {
      if (!seekable) return;
      const target = clampBar(bar, barStarts.length, playback.loop);
      const sec = barStarts[target]!;
      // The red already waits on the walk's first step in that bar (the loop's first, a click on
      // its bar or Left at the loop's start): the seek would cue the step it is on, so no hop
      // of no distance (issue 196), as for Rewind and Home.
      if (
        !playback.playing &&
        along.atFirst &&
        barIndexAt(barStarts, playback.startSec()) === target
      )
        return;
      // A far seek brings the page of its bar in first: the red hops to notes it can find.
      if (host) pageWindowOf(host)?.ensureBar(target);
      if (!playback.playing && sec <= 0) {
        // The red already waits on the first note for the piano: nowhere to go.
        if (along.atFirst) return;
        if (!playback.atStart) playback.rewind(); // the red flies home
        return;
      }
      playback.seek(sec, { leadSec: red.hop(sec) });
    },
    [seekable, barStarts, playback, red, host, along.atFirst],
  );

  const seekKeyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    seekKeyRef.current = (e) => {
      const key = seekKey(e);
      if (key === null || !seekable) return;
      if (key.kind === 'start') {
        // Like the Rewind button; the page goes to its top as Home does anywhere.
        if (along.atFirst) {
          // Nowhere to fly. On the piece's first group the red is at the top and the browser's own
          // scroll to the top is harmless; on a loop's first group it can be far down the page, and
          // the scroll would take the page, and the red with it, off screen (issue 196).
          if (playback.loop) e.preventDefault();
          return;
        }
        if (playback.playing || !playback.atStart) playback.rewind();
        return;
      }
      e.preventDefault(); // no sideways scroll
      const at = playback.playing ? playback.positionSec() : playback.startSec();
      const bar = clampBar(barIndexAt(barStarts, at) + key.bars, barStarts.length, playback.loop);
      seekToBar(bar);
      barSeekRef.current?.footprint(bar);
    };
  });
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => seekKeyRef.current(e);
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const piece = useLibraryPiece(source.kind === 'library' ? source.slug : null);
  const name = source.kind === 'library' ? (piece?.title ?? source.slug) : source.name;
  // The piece's tempo where it starts, for the tempo control's "♩ = …" (polish plan Task 6).
  const tempoMap = doc.score?.tempoMap;
  const qpm = useMemo(() => (tempoMap ? startQpm(tempoMap) : null), [tempoMap]);

  if (doc.status === 'error') {
    // The header's back button is hidden here: the primary one below is the screen's one red.
    // One plain sentence first; the engine's own words follow as the detail.
    return (
      <div className="page score-view">
        <ScoreHeader
          title={doc.title}
          composer={doc.composer}
          piece={piece}
          onBack={null}
          legend={false}
        />
        <main className="score-error stack">
          <p role="alert">
            {source.kind === 'file'
              ? t.score.view.couldNotOpenFile(name)
              : t.score.view.couldNotOpenPiece(name)}
          </p>
          {doc.error && (
            <p className="muted small">
              {t.score.view.details(
                doc.errorCause === undefined ? doc.error : messageOf(doc.errorCause, t),
              )}
            </p>
          )}
          <Button primary onClick={openLibrary}>
            {t.score.header.back}
          </Button>
        </main>
      </div>
    );
  }

  const tune = loaderTune(doc.status, doc.pages.length);
  const statusInputs: StatusInputs = {
    docStatus: doc.status,
    playable,
    hands,
    loading: playback.loading || playback.preparing,
    countIn: playback.countIn,
    alongHint: along.hint,
    alongSound: along.soundWaits ? (touch ? 'tap' : 'click') : null,
  };
  // The timing summary's life (issue 192), kept from render to render: a line above it, Play, or
  // the red moving while stopped ends it for good.
  const life = summaryLifetime(summaryLife, {
    summary: timing.summary,
    higherLine:
      scoreStatusLine(
        { ...statusInputs, alongHint: along.hint?.kind === 'hold' ? along.hint : null },
        t,
      ) !== null,
    currentGroup,
    playing: playback.playing,
    flyingHome: red.flight?.dir === 'home',
  });
  if (life !== summaryLife) setSummaryLife(life);
  const status = scoreStatusLine({ ...statusInputs, timing: life.shown }, t);
  // One toggle, rendered where it stands on screen: first in the dock from 480 px, after Rewind
  // below (the dock's comment).
  const practiceToggle = (
    <button
      ref={toggleRef}
      type="button"
      className="practice-toggle"
      aria-expanded={practiceOpen}
      aria-controls={panelId}
      onClick={() => setPracticeOpen(!practiceOpen)}
    >
      {t.score.view.practice}
    </button>
  );
  return (
    <div className="page score-view">
      <ScoreHeader
        title={doc.title}
        composer={doc.composer}
        piece={piece}
        onBack={openLibrary}
        legend={legendAbove}
        favourite={source.kind === 'library' ? source.slug : null}
      />
      {source.kind === 'file' && source.scan && (
        <p className="no-print">
          <button
            className="text-button"
            onClick={() => {
              if (source.scan) useAppStore.getState().openScan(source.scan);
            }}
          >
            {t.score.view.scanSource}
          </button>
        </p>
      )}
      <div className="score-layout">
        <main className="score-main" ref={measureRef}>
          {/* Says whose digits the score shows when they are the editor's, right above the music
              (the toggle sits in the side panel, off screen on a phone or once scrolled). */}
          {showsEditorial(doc) && (
            <p className="editorial-shown muted small no-print">{t.score.view.editorialShown}</p>
          )}
          {/* Paused with the last group heard marked (T10), the red notes breathe for a moment
              (base.css, `.is-resting`): where Play resumes. */}
          {/* Where the music will be, the loader carries the screen's one red until the score is
              ready; then Play takes it. */}
          {tune && (
            <div className="score-loader no-print">
              <Loader tune={tune} />
            </div>
          )}
          <BarSeek
            host={host}
            layoutKey={barLayout}
            canSeek={canSeek}
            onSeek={seekToBar}
            handle={barSeekRef}
          >
            <ScoreSheet
              pages={doc.pages}
              label={doc.title}
              onHost={setHost}
              windowed
              onPageBuilt={decorate}
              resting={!playback.playing && currentGroup >= 0 && !red.hopping && !along.active}
              hopping={red.hopping}
            />
          </BarSeek>
          {/* The dock: sticky at the bottom of the window while the score column is on screen,
              so Pause and the fingers stay in view wherever the cursor scrolls the score. Its
              DOM order is the order on screen, and so the tab order, at every width (spec 13; no
              CSS `order`). From 480 px: the Practice toggle, the status line, the Practice panel,
              Play and Rewind, the keyboard; the toggle and the status line share the first row
              (toggle left, status right), so a status adds no row. Below 480 px: the status line
              on a row of its own, the panel, Play, Rewind and then the toggle in one row, the
              keyboard. The panel opens above Play, and the dock grows upward, so nothing stands
              between the title and the music. The status line says what the score or the player
              is busy with wherever the reader is; it is always in the page (only its text
              changes, hidden while empty), so screen readers announce its first words too: a
              live region inserted with its text often goes unannounced. */}
          <div className="dock no-print" ref={dockRef}>
            {!narrow && practiceToggle}
            <p role="status" className={statusClass(status)}>
              {status?.text}
            </p>
            {/* Only hidden while closed, so the controls (and a loop being typed) live on.
                `data-embellish` says whether "Add notes between" is still being decided; the e2e
                specs wait on it. */}
            <div
              id={panelId}
              className="practice-panel"
              data-embellish={doc.embellish}
              hidden={!practiceOpen}
              onKeyDown={(e) => {
                if (e.key !== 'Escape') return;
                e.stopPropagation();
                setPracticeOpen(false);
                toggleRef.current?.focus();
              }}
            >
              <PracticeControls
                playback={playback}
                measureCount={doc.score?.measures.length ?? 0}
                qpm={qpm}
                currentBar={currentBar}
                embellish={
                  doc.embellish === 'offered' ? { on: doc.embellished, set: toggleEmbellish } : null
                }
                practiceMode={practiceMode}
                oneHanded={oneHanded(score)}
              />
            </div>
            {/* Paused with the last group heard marked (T10): the cursor keeps the red. While the
                loader plays, it has the red and Play is plain. */}
            <Transport
              playback={playback}
              disabled={doc.status !== 'ready' || !playable}
              resumeShown={!playback.playing && currentGroup >= 0}
              redAway={red.redAway || tune !== null}
              atFirstNote={along.atFirst}
            />
            {narrow && practiceToggle}
            {range && (
              <div className="keyboard">
                <PianoKeyboard
                  lowMidi={range.lowMidi}
                  highMidi={range.highMidi}
                  pressed={pressed}
                  struckCount={struckCount}
                  muted={muted}
                  handLetters={lettersShown(groups, currentGroup, lettered)}
                  hovered={hoveredKey}
                  onStrike={strikeKey}
                  barKeys={barKeys}
                  levels={along.levels}
                />
              </div>
            )}
          </div>
          {red.flight && <RedGhost plan={red.flight} onLanded={red.landed} />}
          <EndBurst host={host} ended={playback.ended} currentGroup={currentGroup} />
        </main>
        <SidePanel
          doc={doc}
          source={source}
          piece={piece}
          setSplitMidi={doc.setSplitMidi}
          legendAbove={legendAbove}
        />
      </div>
    </div>
  );
}
