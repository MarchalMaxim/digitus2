import { useRef, useState } from 'react';
import { useFocusOnArrival } from '../app/focus.js';
import { useAppStore } from '../app/store.js';
import { attribution, type LibraryPiece } from '../library/manifest.js';
import { FingerLegend } from './FingerLegend.js';

export interface ScoreHeaderProps {
  title: string;
  composer: string;
  /** The library piece, for its attribution line; null for a dropped file. */
  piece: LibraryPiece | null;
  /** The back action; null hides the button (the error state shows its own, primary one). */
  onBack: (() => void) | null;
  /** False where there is no score to read (the error state): no finger legend. Default true. */
  legend?: boolean;
}

/**
 * The score view's header. Its heading takes the focus when the score view replaces the library
 * (it is mounted once per piece, in the error state too). Until the reader's first Play anywhere it
 * ends with the finger legend, under the credit line (UI batch, spec 12), except in the error
 * state, which has no score to read; the side panel always has it.
 */
export function ScoreHeader({ title, composer, piece, onBack, legend = true }: ScoreHeaderProps) {
  const credit = piece ? attribution(piece) : null;
  const heading = useRef<HTMLHeadingElement>(null);
  useFocusOnArrival(heading);
  // Decided once per score view (spec 12): the first Play sets legendSeen, and the legend must
  // not vanish from above the music while the cursor plays it. Read once, not subscribed.
  const [showLegend] = useState(() => !useAppStore.getState().settings.legendSeen);
  return (
    <header className="score-header">
      {onBack && (
        <button type="button" className="back-button no-print" onClick={onBack}>
          Back to the library
        </button>
      )}
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
      {legend && showLegend && <FingerLegend />}
    </header>
  );
}
