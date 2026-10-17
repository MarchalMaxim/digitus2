import { en } from '../i18n/en/index.js';
import { useT } from '../i18n/i18n.js';

/**
 * What the finger numbers mean (polish plan Task 5, review S4): no screen said that 1 is the thumb
 * and 5 the little finger, or which staff is which hand, the one thing a beginner needs to know
 * to read the score at all. The English text, for tests that look for it; the screen shows the
 * one in the language on screen.
 */
export const FINGER_LEGEND = en.score.fingerLegend;

/**
 * The legend as one line: under the score's header until the reader's first Play, and in the
 * score's side panel (UI batch, spec 12). It shows once on a screen: the side panel passes
 * `className` "wide-only" while the header has it too (base.css).
 */
export function FingerLegend({ className }: { className?: string | undefined }) {
  const t = useT();
  return (
    <p className={className ? `finger-legend ${className}` : 'finger-legend'}>
      {t.score.fingerLegend}
    </p>
  );
}
