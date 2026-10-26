import { useLayoutEffect } from 'react';
import { prefersReducedMotion } from '../design/motion.js';
import { haloProgress, haloRadius, type Halo } from './halo.js';
import { clearHalos, drawHalo, haloAnchor, setHaloRadius } from './render/halo.js';

/**
 * Draws the walk's halo (issue 204) around the topmost notehead the cue marks in `host`, and closes
 * it in frame by frame, straight on the SVG: no React state per frame. A layout effect, declared in
 * ScoreView after useCursor and usePlayAlong, so it runs after the cursor has marked the cued notes
 * in the same commit, and the ring and the new marks reach the screen in one paint. One
 * `requestAnimationFrame` loop runs while the ring is drawn; it reads `performance.now()` and the
 * reduced-motion query each frame, writes the radius only when it changes, and removes the ring
 * when the gap is up. A hidden tab gets no frames and is right again at the next one, because the
 * radius is a function of the time. `layoutKey` (the pages) draws it again on new pages.
 */
export function useAlongHalo(host: Element | null, halo: Halo | null, layoutKey: unknown): void {
  useLayoutEffect(() => {
    if (!host) return;
    clearHalos(host);
    if (!halo) return;
    const progress = haloProgress(halo, performance.now(), prefersReducedMotion());
    if (progress === null) return;
    const anchor = haloAnchor(host);
    if (!anchor) return; // the cued notes are not in the DOM: no halo
    const circle = drawHalo(anchor, haloRadius(anchor.w, progress));
    let frame = 0;
    const step = () => {
      frame = 0;
      if (!circle.isConnected) return; // its page was rebuilt: no halo until the next pass
      const p = haloProgress(halo, performance.now(), prefersReducedMotion());
      if (p === null) {
        circle.remove();
        return;
      }
      setHaloRadius(circle, haloRadius(anchor.w, p));
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      circle.remove();
    };
  }, [host, halo, layoutKey]);
}
