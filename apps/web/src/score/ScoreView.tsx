import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useAppStore, type HandsMode, type PieceSource } from '../app/store.js';
import { Button } from '../design/Button.js';
import { flash } from '../design/motion.js';
import { pieceBySlug } from '../library/manifest.js';
import { Keyboard, keyboardRange } from './Keyboard.js';
import { buildOnsetGroups, hasNotesFor } from './onsetGroups.js';
import { setDigits } from './render/dom.js';
import { ScoreHeader } from './ScoreHeader.js';
import { ScoreSheet } from './ScoreSheet.js';
import { SidePanel } from './SidePanel.js';
import { Transport } from './Transport.js';
import { useCursor } from './useCursor.js';
import { mutedHandsFor, usePlayback } from './usePlayback.js';
import { useScoreDocument, type DocStatus } from './useScoreDocument.js';

const STATUS_TEXT: Partial<Record<DocStatus, string>> = {
  idle: 'Loading the score…',
  loading: 'Loading the score…',
  fingering: 'Fingering…',
  rendering: 'Preparing the score…',
};

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

export function ScoreView({ source }: { source: PieceSource }) {
  const openLibrary = useAppStore((s) => s.openLibrary);
  const [measureRef, width] = useElementWidth<HTMLElement>();
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
  const { pressed } = useCursor({
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

  const statusText =
    doc.status !== 'ready'
      ? (STATUS_TEXT[doc.status] ?? null)
      : playable
        ? null
        : nothingToPlayText(hands);
  return (
    <div className="page score-view">
      <ScoreHeader title={doc.title} composer={doc.composer} piece={piece} onBack={openLibrary} />
      <div className="score-layout">
        <main className="score-main" ref={measureRef}>
          <Transport
            playback={playback}
            measureCount={doc.score?.measures.length ?? 0}
            disabled={doc.status !== 'ready' || !playable}
          />
          {statusText && (
            <p role="status" className="score-status muted">
              {statusText}
            </p>
          )}
          <ScoreSheet pages={doc.pages} label={doc.title} onHost={setHost} />
          {range && (
            <div className="keyboard no-print">
              <Keyboard lowMidi={range.lowMidi} highMidi={range.highMidi} pressed={pressed} />
            </div>
          )}
        </main>
        <SidePanel doc={doc} source={source} piece={piece} setSplitMidi={doc.setSplitMidi} />
      </div>
    </div>
  );
}
