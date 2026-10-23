import { useEffect, useState } from 'react';
import { useT } from '../i18n/i18n.js';
import { barAt, secondsLeft, type Stretch } from './progress.js';

/** How often the bar and its time line move. */
const TICK_MS = 250;

/**
 * The scan bar of the whole batch (progress.ts): full once `done`. Black, never red: the loader
 * above it is the screen's one red. The time line is a plain paragraph, not a live region, so a
 * screen reader does not read it out every tick; the bar carries it as its value text.
 */
export function ScanProgress({ stretch, done }: { stretch: Stretch; done: boolean }) {
  const t = useT();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (done) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [done, stretch]);
  const elapsed = now - stretch.since;
  const value = done ? 1 : barAt(stretch, now);
  const left = secondsLeft(elapsed, stretch.expected);
  const line = done ? '' : left === null ? t.scan.view.overdue : t.scan.view.secondsLeft(left);
  return (
    <div className="scan-progress">
      <div
        className="scan-bar"
        role="progressbar"
        aria-label={t.scan.view.progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={done ? 100 : Math.min(99, Math.round(value * 100))}
        aria-valuetext={line || undefined}
      >
        <div className="scan-bar-fill" style={{ transform: `scaleX(${value})` }} />
      </div>
      <p className="small muted">{line}</p>
    </div>
  );
}
