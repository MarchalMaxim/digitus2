import { useEffect, useState } from 'react';
import { useT } from '../i18n/i18n.js';
import { progressAt, secondsLeft } from './progress.js';

/** How often the bar and its time line move. */
const TICK_MS = 250;

/**
 * The scan bar of one page (progress.ts): sent at `since` (Date.now), expected to take `expected`
 * ms, full once `done`. Black, never red: the loader above it is the screen's one red.
 */
export function ScanProgress({
  since,
  expected,
  done,
}: {
  since: number;
  expected: number;
  done: boolean;
}) {
  const t = useT();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (done) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [done]);
  const elapsed = now - since;
  const value = done ? 1 : progressAt(elapsed, expected);
  const left = secondsLeft(elapsed, expected);
  const line = done ? '' : left === null ? t.scan.view.overdue : t.scan.view.secondsLeft(left);
  return (
    <div className="scan-progress">
      <div
        className="scan-bar"
        role="progressbar"
        aria-label={t.scan.view.progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        aria-valuetext={line || undefined}
      >
        <div className="scan-bar-fill" style={{ transform: `scaleX(${value})` }} />
      </div>
      <p className="small muted">{line}</p>
    </div>
  );
}
