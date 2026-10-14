import { useRef } from 'react';
import { useFocusOnArrival } from '../app/focus.js';
import { attribution, type LibraryPiece } from '../library/manifest.js';

export interface ScoreHeaderProps {
  title: string;
  composer: string;
  /** The library piece, for its attribution line; null for a dropped file. */
  piece: LibraryPiece | null;
  /** The back action; null hides the button (the error state shows its own, primary one). */
  onBack: (() => void) | null;
}

/**
 * The score view's header. Its heading takes the focus when the score view replaces the library
 * (it is mounted once per piece, in the error state too).
 */
export function ScoreHeader({ title, composer, piece, onBack }: ScoreHeaderProps) {
  const credit = piece ? attribution(piece) : null;
  const heading = useRef<HTMLHeadingElement>(null);
  useFocusOnArrival(heading);
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
    </header>
  );
}
