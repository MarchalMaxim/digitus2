import { useRef, useState } from 'react';
import { useFocusOnArrival } from '../app/focus.js';
import { useAppStore } from '../app/store.js';
import { ThemeToggle } from '../design/ThemeToggle.js';
import { useT } from '../i18n/i18n.js';
import { attribution, type LibraryPiece } from '../library/manifest.js';
import { FingerLegend } from './FingerLegend.js';

export interface ScoreHeaderProps {
  title: string;
  composer: string;
  /** The library piece, for its attribution line; null for a dropped file. */
  piece: LibraryPiece | null;
  /** The back action; null hides the button (the error state shows its own, primary one). */
  onBack: (() => void) | null;
  /**
   * Whether the header ends with the finger legend: the score view's once-per-view decision
   * (`useLegendAbove`); false where there is no score to read (the error state). Default false.
   */
  legend?: boolean;
}

/**
 * Whether a score view shows the finger legend under its header: until the reader's first Play
 * anywhere (UI batch, spec 12). Decided once, when the view mounts: the first Play sets
 * legendSeen, and the legend must not vanish from above the music while the cursor plays it.
 * Read once, not subscribed. The score view hands the same answer to the side panel, so the
 * legend shows once on a screen (base.css: from 900 px the side panel's copy, beside the score;
 * below 900 px the header's).
 */
export function useLegendAbove(): boolean {
  const [shown] = useState(() => !useAppStore.getState().settings.legendSeen);
  return shown;
}

/**
 * The score view's header. Its heading takes the focus when the score view replaces the library
 * (it is mounted once per piece, in the error state too). With `legend` it ends with the finger
 * legend, under the credit line (UI batch, spec 12); from 900 px that copy is hidden, and the
 * side panel's, beside the score, is the one shown.
 */
export function ScoreHeader({ title, composer, piece, onBack, legend = false }: ScoreHeaderProps) {
  const t = useT();
  const credit = piece ? attribution(piece, t) : null;
  const heading = useRef<HTMLHeadingElement>(null);
  useFocusOnArrival(heading);
  return (
    <header className="score-header">
      {onBack && (
        <button type="button" className="back-button no-print" onClick={onBack}>
          {t.score.header.back}
        </button>
      )}
      <ThemeToggle />
      <h1 ref={heading} tabIndex={-1}>
        {title}
      </h1>
      {composer && <p className="muted">{composer}</p>}
      {credit && (
        <p className="muted small">
          {credit.url ? (
            <a href={credit.url} target="_blank" rel="noreferrer">
              {credit.text}
            </a>
          ) : (
            credit.text
          )}
        </p>
      )}
      {legend && <FingerLegend />}
    </header>
  );
}
