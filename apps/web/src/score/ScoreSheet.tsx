import { useEffect, useLayoutEffect, useRef } from 'react';
import { useT } from '../i18n/i18n.js';

export interface ScoreSheetProps {
  /** SVG pages from the Verovio worker, in order. */
  pages: string[];
  /** The piece title; the host is announced as "Score of <label>" (in the language on screen). */
  label: string;
  /** Receives the host element on mount (and null on unmount) for digit patching and the cursor. */
  onHost?: (host: HTMLDivElement | null) => void;
  /**
   * Paused with the last group heard marked (T10): the red notes breathe three times, then rest
   * (base.css, `.score-sheet.is-resting`), so the eye finds where Play resumes. Default false.
   */
  resting?: boolean;
}

/**
 * Hosts the rendered pages as inline SVG. The markup is the output of our own Verovio worker
 * laid out from the score being shown; no user-supplied HTML is ever inserted. New pages replace
 * the old ones, never append. Each SVG scales to the column width (`.score-sheet svg` in
 * base.css), so the layout only has to be redone when the width bucket changes.
 */
export function ScoreSheet({ pages, label, onHost, resting = false }: ScoreSheetProps) {
  const t = useT();
  const hostRef = useRef<HTMLDivElement>(null);

  // A layout effect: the pages are in before the parent's layout effects run (the dimming of a
  // hand left out, ScoreView.tsx) and before the paint, so they never show undimmed for a frame.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host) host.innerHTML = pages.join('');
  }, [pages]);

  useEffect(() => {
    onHost?.(hostRef.current);
    return () => onHost?.(null);
  }, [onHost]);

  return (
    <div
      className={resting ? 'score-sheet is-resting' : 'score-sheet'}
      role="img"
      aria-label={t.score.sheet.label(label)}
      ref={hostRef}
    />
  );
}
