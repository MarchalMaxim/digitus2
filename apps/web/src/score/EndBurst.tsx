/**
 * The finish (issue #97): when the piece has been played to its end, a few ink notes rise from
 * the last group heard, in the easter egg's own vocabulary (app/NoteBurst.tsx, `drawBurst`), as
 * the red flies home to Play (RedFlight.tsx). The burst stands at the topmost notehead the cursor
 * marked last, read before its marks clear; it is ink only, since the flying red is the screen's
 * one red on every frame. Once per play-through: it answers `playback.ended`, which only the
 * transport's end counts, never Pause, Rewind, a seek, a loop (which never ends) or a change of
 * hands. Nothing under prefers-reduced-motion, and nothing when no group was heard.
 */
import { useLayoutEffect, useRef, useState, type JSX } from 'react';
import { BurstNotes, drawBurst, type Burst } from '../app/NoteBurst.js';
import { prefersReducedMotion } from '../design/motion.js';
import { topmost, useLastHeads } from './RedFlight.js';

export interface EndBurstProps {
  /** The score sheet's host (the cursor marks its notes). */
  host: Element | null;
  /** `playback.ended`: a new count lets the finish rise. */
  ended: number;
  /** The group the cursor marks (useCursor), -1 when none. */
  currentGroup: number;
}

export function EndBurst({ host, ended, currentGroup }: EndBurstProps): JSX.Element {
  const lastHeads = useLastHeads(host, currentGroup);
  const [burst, setBurst] = useState<Burst | null>(null);
  const endedRef = useRef(ended);
  // A layout effect: the burst mounts in the paint that clears the cursor's marks, with the
  // flying red.
  useLayoutEffect(() => {
    if (ended === endedRef.current) return;
    endedRef.current = ended;
    const heads = lastHeads.current.filter((h) => h.isConnected);
    if (heads.length === 0 || prefersReducedMotion()) return;
    const at = topmost(heads);
    if (!at) return;
    setBurst((prev) => ({
      x: at.x,
      y: at.y,
      gen: (prev?.gen ?? 0) + 1,
      notes: drawBurst(Math.random, 'end'),
    }));
  }, [ended, lastHeads]);

  return (
    <div className="note-burst-layer end-burst no-print" aria-hidden="true">
      {burst && <BurstNotes key={burst.gen} burst={burst} />}
    </div>
  );
}
