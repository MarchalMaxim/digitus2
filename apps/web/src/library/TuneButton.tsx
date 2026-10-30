import { useMemo, type CSSProperties } from 'react';
import { useT } from '../i18n/i18n.js';
import { tuneFor } from './tune.js';

/** Where the four notes stand along the staff, in the drawing's 44 by 26 box. */
const NOTE_X = [7, 17, 27, 37] as const;
/** The staff's middle line, as its y: a note on or above it has its stem down. */
const MIDDLE_LINE = 13;
/** The staff's five lines, as their y in the same box. */
const LINES = [5, 9, 13, 17, 21] as const;

export interface TuneButtonProps {
  /** How many times the library has been dealt: the tune on the staff is this deal's. */
  deal: number;
  onDeal(): void;
}

/**
 * The control that deals the arrival page's shelves again (issue 228, chosen on the design canvas
 * as "A new tune"): a small staff with four notes that, on each press, leap to new pitches one after
 * another with a slight spring. Ink only, never red. The notes are moved by a CSS transform so the
 * leap transitions (library.css); under reduced motion the durations are 0 and the tune simply
 * changes. Named for what a press does, not for the drawing.
 */
export function TuneButton({ deal, onDeal }: TuneButtonProps) {
  const t = useT();
  const tune = useMemo(() => tuneFor(deal), [deal]);
  return (
    <button
      type="button"
      className="tune-button no-print"
      aria-label={t.library.list.shuffle}
      title={t.library.list.shuffle}
      onClick={onDeal}
    >
      <svg viewBox="0 0 44 26" width="44" height="26" aria-hidden="true" focusable="false">
        {LINES.map((y) => (
          <line
            key={y}
            className="tune-line"
            x1="0"
            y1={y}
            x2="44"
            y2={y}
            stroke="currentColor"
            strokeWidth="0.9"
          />
        ))}
        {NOTE_X.map((x, i) => (
          <g
            key={x}
            className="tune-note"
            style={{ transform: `translate(${x}px, ${tune[i]}px)`, '--note': i } as CSSProperties}
          >
            <ellipse rx="2.9" ry="2.1" transform="rotate(-22)" fill="currentColor" />
            {/* On or above the middle line the stem hangs from the head's left, else rises on its right. */}
            {tune[i]! <= MIDDLE_LINE ? (
              <line x1="-2.5" y1="0.6" x2="-2.5" y2="10" stroke="currentColor" strokeWidth="1.1" />
            ) : (
              <line x1="2.5" y1="-0.6" x2="2.5" y2="-10" stroke="currentColor" strokeWidth="1.1" />
            )}
          </g>
        ))}
      </svg>
    </button>
  );
}
