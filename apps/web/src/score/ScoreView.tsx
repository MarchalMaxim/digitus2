import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { messageOf } from '../app/errors.js';
import { useAppStore, type HandsMode, type PieceSource } from '../app/store.js';
import { Button } from '../design/Button.js';
import { Loader, type LoaderTune } from '../design/Loader.js';
import { NARROW_QUERY, useMediaQuery } from '../design/media.js';
import { flash, prefersReducedMotion } from '../design/motion.js';
import { messages, useT } from '../i18n/i18n.js';
import type { Messages } from '../i18n/messages.js';
import { useLibraryPiece } from '../library/useLibraryPiece.js';
import { BarSeek, type BarSeekHandle } from './BarSeek.js';
import { barIndexAt, barStartSecs, clampBar, seekKey } from './bars.js';
import { useEmbellishCarry } from './carry.js';
import { letteredBars, lettersShown } from './handLetters.js';
import { Keyboard, keyboardRange } from './Keyboard.js';
import { buildOnsetGroups, hasNotesFor } from './onsetGroups.js';
import { RedGhost, useRedFlight } from './RedFlight.js';
import {
  mutedElements,
  redim,
  setDigits,
  settleSweep,
  sweepDimming,
  systemsOnScreen,
} from './render/dom.js';
import { ScoreHeader, useLegendAbove } from './ScoreHeader.js';
import { ScoreSheet } from './ScoreSheet.js';
import { SidePanel } from './SidePanel.js';
import { PracticeControls, startQpm, Transport } from './Transport.js';
import { useCursor } from './useCursor.js';
import { mutedHandsFor, usePlayback, type CountIn } from './usePlayback.js';
import { useScoreDocument, type DocStatus, type ScoreDocument } from './useScoreDocument.js';

/** The status line's text while the score is busy, by status. */
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
  /** The player is fetching the piano's samples after the first Play. */
  loading: boolean;
  countIn: CountIn | null;
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
 * piano after the first Play, then the count-in, each click's beat in its bar ("1", "2", "3",
 * "4"; "1", "2" before a 3/4 pickup that enters on 3; "1" to "4" then "1" when a whole bar comes
 * before a pickup). Null when there is nothing to say (a ready score, stopped or playing the
 * music). Written in `t` (default: the language on screen).
 */
export function scoreStatusLine(
  { docStatus, playable, hands, loading, countIn }: StatusInputs,
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

  // A re-solve publishes only the digits that changed: patch them into the pages in place.
  useEffect(() => {
    if (host && doc.digitChanges) setDigits(host, doc.digitChanges, flash);
  }, [host, doc.digitChanges]);

  // Playback, the cursor and the keyboard. An error stops playback (the score is gone).
  const score = doc.status === 'error' ? null : doc.score;
  const playback = usePlayback(score);
  const hands = useAppStore((s) => s.settings.hands);
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
  // A hand switch on the same pages fades the hand left out (or back in) bar by bar, from the first
  // bar of each system to the last (`sweepDimming`), in the systems on screen; the rest of the
  // piece, and new pages, change at once. The systems are found before any class changes, while
  // the layout is clean. What each selection dims is found once per layout (`mutedElements` walks
  // every page), so a switch only moves the dimming between two lists (issue #79).
  const dimmedRef = useRef<{
    host: Element;
    pages: string[];
    lists: Map<ReadonlySet<string>, Element[]>;
    shown: Element[];
  } | null>(null);
  useLayoutEffect(() => {
    if (!host) return;
    const last = dimmedRef.current;
    const switched = last !== null && last.host === host && last.pages === doc.pages;
    const lists = switched ? last.lists : new Map<ReadonlySet<string>, Element[]>();
    let shown = lists.get(mutedIds);
    if (!shown) {
      shown = mutedElements(host, mutedIds);
      lists.set(mutedIds, shown);
    }
    const spread = prefersReducedMotion() ? 0 : HAND_SWEEP_MS;
    const onScreen = switched && spread > 0 ? systemsOnScreen(host) : new Set<Element>();
    // New pages arrive with nothing dimmed.
    const before = switched ? last.shown : [];
    redim(before, shown);
    dimmedRef.current = { host, pages: doc.pages, lists, shown };
    if (!switched) return;
    sweepDimming(host, new Set([...before, ...shown]), spread, onScreen);
  }, [host, doc.pages, mutedIds]);
  // Each element swept settles into its resting look when its own fade ends (`settleSweep`).
  useEffect(() => {
    if (!host) return;
    const settle = (e: Event) => settleSweep(e.target);
    host.addEventListener('transitionend', settle);
    host.addEventListener('animationend', settle);
    return () => {
      host.removeEventListener('transitionend', settle);
      host.removeEventListener('animationend', settle);
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
  const seekToBar = useCallback(
    (bar: number) => {
      if (!seekable) return;
      const target = clampBar(bar, barStarts.length, playback.loop);
      const sec = barStarts[target]!;
      if (!playback.playing && sec <= 0) {
        if (!playback.atStart) playback.rewind(); // the red flies home
        return;
      }
      playback.seek(sec, { leadSec: red.hop(sec) });
    },
    [seekable, barStarts, playback, red],
  );

  // "Add notes between" (issue #67). The switch swaps the score, which halts playback and drops
  // the loop (usePlayback.ts): the bar, the loop and the play state are recorded and put back
  // once the version asked for is on screen (carry.ts). Called after usePlayback, so its halt
  // for the new score has run first.
  const toggleEmbellish = useEmbellishCarry(doc, score, playback, barStarts);

  const seekKeyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    seekKeyRef.current = (e) => {
      const key = seekKey(e);
      if (key === null || !seekable) return;
      if (key.kind === 'start') {
        // Like the Rewind button; the page goes to its top as Home does anywhere.
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
  const status = scoreStatusLine(
    {
      docStatus: doc.status,
      playable,
      hands,
      loading: playback.loading,
      countIn: playback.countIn,
    },
    t,
  );
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
              resting={!playback.playing && currentGroup >= 0 && !red.hopping}
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
              />
            </div>
            {/* Paused with the last group heard marked (T10): the cursor keeps the red. While the
                loader plays, it has the red and Play is plain. */}
            <Transport
              playback={playback}
              disabled={doc.status !== 'ready' || !playable}
              resumeShown={!playback.playing && currentGroup >= 0}
              redAway={red.redAway || tune !== null}
            />
            {narrow && practiceToggle}
            {range && (
              <div className="keyboard">
                <Keyboard
                  lowMidi={range.lowMidi}
                  highMidi={range.highMidi}
                  pressed={pressed}
                  struckCount={struckCount}
                  muted={muted}
                  handLetters={lettersShown(groups, currentGroup, lettered)}
                />
              </div>
            )}
          </div>
          {red.flight && <RedGhost plan={red.flight} onLanded={red.landed} />}
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
