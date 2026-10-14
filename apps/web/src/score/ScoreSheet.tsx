import { useEffect, useRef } from 'react';

export interface ScoreSheetProps {
  /** SVG pages from the Verovio worker, in order. */
  pages: string[];
  /** The piece title; the host is announced as "Score of <label>". */
  label: string;
  /** Receives the host element on mount (and null on unmount) for digit patching and the cursor. */
  onHost?: (host: HTMLDivElement | null) => void;
}

/**
 * Hosts the rendered pages as inline SVG. The markup is the output of our own Verovio worker
 * laid out from the score being shown; no user-supplied HTML is ever inserted. New pages replace
 * the old ones, never append. Each SVG scales to the column width (`.score-sheet svg` in
 * base.css), so the layout only has to be redone when the width bucket changes.
 */
export function ScoreSheet({ pages, label, onHost }: ScoreSheetProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (host) host.innerHTML = pages.join('');
  }, [pages]);

  useEffect(() => {
    onHost?.(hostRef.current);
    return () => onHost?.(null);
  }, [onHost]);

  return <div className="score-sheet" role="img" aria-label={`Score of ${label}`} ref={hostRef} />;
}
