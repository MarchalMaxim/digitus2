import { useEffect, useLayoutEffect, useRef } from 'react';
import { useT } from '../i18n/i18n.js';
import { buildPageIndex } from './render/pageIndex.js';
import { keepAspect, PageWindow, WINDOW_MIN_PAGES } from './render/pageWindow.js';

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
  /**
   * The red is hopping to the cue the cursor marks (T13, RedFlight.tsx): the marked notes stay in
   * ink until it lands (base.css, `.score-sheet.is-hopping`). Default false.
   */
  hopping?: boolean;
  /**
   * Keep only the pages near the screen in the DOM (issue 99, render/pageWindow.ts) when the piece
   * has `WINDOW_MIN_PAGES` pages or more; the others stand empty, with their height. The score
   * view sets it; the scan review keeps every page. Default false.
   */
  windowed?: boolean;
  /**
   * A page was built after the sheet was laid out (a windowed sheet, as it scrolls or is read):
   * the place to decorate it. The pages built with the layout are not announced.
   */
  onPageBuilt?: (page: SVGSVGElement, i: number) => void;
}

/**
 * Hosts the rendered pages as inline SVG. The markup is the output of our own Verovio worker
 * laid out from the score being shown; no user-supplied HTML is ever inserted. New pages replace
 * the old ones, never append. Each SVG scales to the column width (`.score-sheet svg` in
 * base.css), so the layout only has to be redone when the width bucket changes.
 */
export function ScoreSheet({
  pages,
  label,
  onHost,
  resting = false,
  hopping = false,
  windowed = false,
  onPageBuilt,
}: ScoreSheetProps) {
  const t = useT();
  const hostRef = useRef<HTMLDivElement>(null);
  const builtRef = useRef(onPageBuilt);
  useLayoutEffect(() => {
    builtRef.current = onPageBuilt;
  });

  // A layout effect: the pages are in before the parent's layout effects run (the dimming of a
  // hand left out, ScoreView.tsx) and before the paint, so they never show undimmed for a frame.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (windowed && pages.length >= WINDOW_MIN_PAGES) {
      const sheet = new PageWindow(host, buildPageIndex(pages), (page, i) =>
        builtRef.current?.(page, i),
      );
      sheet.start();
      return () => sheet.dispose();
    }
    host.innerHTML = pages.join('');
    for (const page of Array.from(host.children)) keepAspect(page);
  }, [pages, windowed]);

  useEffect(() => {
    onHost?.(hostRef.current);
    return () => onHost?.(null);
  }, [onHost]);

  return (
    <div
      className={['score-sheet', resting && 'is-resting', hopping && 'is-hopping']
        .filter(Boolean)
        .join(' ')}
      role="img"
      aria-label={t.score.sheet.label(label)}
      ref={hostRef}
    />
  );
}
