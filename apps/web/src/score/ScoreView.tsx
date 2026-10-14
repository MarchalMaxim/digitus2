import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useAppStore, type HandsMode, type PieceSource } from '../app/store.js';
import { Button } from '../design/Button.js';
import { NARROW_QUERY, useMediaQuery } from '../design/media.js';
import { flash } from '../design/motion.js';
import { pieceBySlug } from '../library/manifest.js';
import { Keyboard, keyboardRange } from './Keyboard.js';
import { buildOnsetGroups, hasNotesFor } from './onsetGroups.js';
import { dimNotes, setDigits } from './render/dom.js';
import { ScoreHeader } from './ScoreHeader.js';
import { ScoreSheet } from './ScoreSheet.js';
import { SidePanel } from './SidePanel.js';
import { PracticeControls, startQpm, Transport } from './Transport.js';
import { useCursor } from './useCursor.js';
import { mutedHandsFor, usePlayback, type CountIn } from './usePlayback.js';
import { useScoreDocument, type DocStatus, type ScoreDocument } from './useScoreDocument.js';

const STATUS_TEXT: Partial<Record<DocStatus, string>> = {
  idle: 'Loading the score…',
  loading: 'Loading the score…',
  fingering: 'Fingering…',
  rendering: 'Preparing the score…',
};

/** The status line while the first Play of a score fetches the piano's samples. */
export const LOADING_PIANO_TEXT = 'Loading the piano…';

/** The line above the score while it shows the editor's fingering (polish plan Task 5). */
export const EDITORIAL_SHOWN_TEXT = "Showing the editor's fingering";

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

/** What the error state says first, before the engine's message. */
const FILE_ERROR_TEXT =
  'This file could not be read as sheet music. digitus2 opens MusicXML and MIDI files (.musicxml, .xml, .mxl, .mid or .midi).';
const PIECE_ERROR_TEXT = 'Something went wrong while preparing this piece. Please try again.';

/** The status line when the selected hands have no notes in this piece. */
function nothingToPlayText(hands: HandsMode): string {
  if (hands === 'L') return 'This piece has no notes for the left hand.';
  if (hands === 'R') return 'This piece has no notes for the right hand.';
  return 'This piece has no notes to play.';
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
 * music).
 */
export function scoreStatusLine({
  docStatus,
  playable,
  hands,
  loading,
  countIn,
}: StatusInputs): StatusLine | null {
  const info = (text: string): StatusLine => ({ text, kind: 'info' });
  if (docStatus !== 'ready') {
    const text = STATUS_TEXT[docStatus];
    return text === undefined ? null : info(text);
  }
  if (!playable) return info(nothingToPlayText(hands));
  if (loading) return info(LOADING_PIANO_TEXT);
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
  const openLibrary = useAppStore((s) => s.openLibrary);
  const [measureRef, width] = useElementWidth<HTMLElement>();
  const dockRef = useDockHeight<HTMLDivElement>();
  const narrow = useMediaQuery(NARROW_QUERY);
  const doc = useScoreDocument(source, width);
  const [host, setHost] = useState<HTMLDivElement | null>(null);

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
  // dims and the cursor re-marks in the same paint, and new pages arrive already dimmed.
  const mutedIds = useMemo(
    () => new Set(score?.notes.filter((n) => mutedHands.includes(n.hand)).map((n) => n.id)),
    [score, mutedHands],
  );
  useLayoutEffect(() => {
    if (host) dimNotes(host, mutedIds);
  }, [host, doc.pages, mutedIds]);
  const { pressed, muted } = useCursor({
    host,
    groups,
    playback,
    assignment: doc.assignment,
    mutedHands,
  });
  // A selection with no notes (a one-hand piece, the other hand chosen) has nothing to hear and
  // nothing for the cursor to mark: Play stays the red element, unavailable, and a running
  // playback stops.
  const playable = useMemo(() => hasNotesFor(groups, mutedHands), [groups, mutedHands]);
  const { playing, pause } = playback;
  useEffect(() => {
    if (playing && !playable) pause();
  }, [playing, playable, pause]);

  const piece = source.kind === 'library' ? (pieceBySlug(source.slug) ?? null) : null;
  const name = source.kind === 'library' ? (piece?.title ?? source.slug) : source.name;
  // The piece's tempo where it starts, for the tempo control's "♩ = …" (polish plan Task 6).
  const tempoMap = doc.score?.tempoMap;
  const qpm = useMemo(() => (tempoMap ? startQpm(tempoMap) : null), [tempoMap]);

  if (doc.status === 'error') {
    // The header's back button is hidden here: the primary one below is the screen's one red.
    // One plain sentence first; the engine's own words follow as the detail.
    return (
      <div className="page score-view">
        <ScoreHeader title={doc.title} composer={doc.composer} piece={piece} onBack={null} />
        <main className="score-error stack">
          <p role="alert">
            Could not open {name}. {source.kind === 'file' ? FILE_ERROR_TEXT : PIECE_ERROR_TEXT}
          </p>
          {doc.error && <p className="muted small">Details: {doc.error}</p>}
          <Button primary onClick={openLibrary}>
            Back to the library
          </Button>
        </main>
      </div>
    );
  }

  const status = scoreStatusLine({
    docStatus: doc.status,
    playable,
    hands,
    loading: playback.loading,
    countIn: playback.countIn,
  });
  return (
    <div className="page score-view">
      <ScoreHeader title={doc.title} composer={doc.composer} piece={piece} onBack={openLibrary} />
      <div className="score-layout">
        <main className="score-main" ref={measureRef}>
          {/* Above the score at every width, one element in one place (so what it holds, such
              as a loop being typed, survives the window crossing 480 px). Wider than 480 px the
              controls stand open; narrower they fold into a closed "Practice" disclosure, one
              line above the music, so a phone's first screen shows the title, Practice, a whole
              system and the dock (the title and the open controls used to fill it). */}
          <PracticeControls
            playback={playback}
            measureCount={doc.score?.measures.length ?? 0}
            qpm={qpm}
            collapsible={narrow}
          />
          {/* Says whose digits the score shows when they are the editor's, right above the music
              (the toggle sits in the side panel, off screen on a phone or once scrolled). */}
          {showsEditorial(doc) && (
            <p className="editorial-shown muted small no-print">{EDITORIAL_SHOWN_TEXT}</p>
          )}
          <ScoreSheet pages={doc.pages} label={doc.title} onHost={setHost} />
          {/* The dock: sticky at the bottom of the window while the score column is on screen,
              so Pause and the fingers stay in view wherever the cursor scrolls the score. The
              status line is its first row, next to Play: what the score or the player is busy
              with shows wherever the reader is (deep in a score the top of the page is far
              away), and it comes and goes without moving the music. It is always in the page
              (only its text changes, hidden while empty), so screen readers announce its first
              words too: a live region inserted with its text often goes unannounced. */}
          <div className="dock no-print" ref={dockRef}>
            <p role="status" className={statusClass(status)}>
              {status?.text}
            </p>
            <Transport playback={playback} disabled={doc.status !== 'ready' || !playable} />
            {range && (
              <div className="keyboard">
                <Keyboard
                  lowMidi={range.lowMidi}
                  highMidi={range.highMidi}
                  pressed={pressed}
                  muted={muted}
                />
              </div>
            )}
          </div>
        </main>
        <SidePanel doc={doc} source={source} piece={piece} setSplitMidi={doc.setSplitMidi} />
      </div>
    </div>
  );
}
