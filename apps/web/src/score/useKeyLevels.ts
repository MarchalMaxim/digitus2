import { useLayoutEffect, type RefObject } from 'react';
import { prefersReducedMotion } from '../design/motion.js';
import { levelAt, levelRect, moving, type KeyLevel, type KeyLevels } from './keyLevels.js';

/**
 * Where a key's level goes (issue 185): whether the key is black, the held bar the level grows
 * from, and the scale the key takes, the cue's or a key held on the piano's (`KEY_TRAVEL`), which
 * the hand letters' clip needs because the letters are not in a key's group.
 */
export interface KeyGeometry {
  black: boolean;
  bar: { x: number; y: number; width: number; height: number };
  travel: number;
}

/** One rectangle the loop moves, and the last `y` and `height` it wrote to it. */
interface Mover {
  el: Element;
  /** 1 for the level and the clip of a key's number, the key's travel for the clip of its letter. */
  scale: number;
  y: number;
  height: number;
}

/** A key with a level on show: the level, the rectangles that follow it and the key's geometry. */
interface Target {
  level: KeyLevel;
  geometry: KeyGeometry;
  movers: Mover[];
}

/**
 * Moves the keys' levels (issue 185), frame by frame, straight on the SVG: no React state changes
 * per frame, and a level rising re-renders nothing. The keyboard draws each level, the clip of the
 * finger number over it and the clip of the hand letter over it as rectangles marked
 * `data-level-for`, `data-clip-for` and `data-hand-clip-for`; this sets their `y` and `height`
 * from the clock (`levelAt`, `levelRect`), the hand letters' scaled by the key's travel.
 *
 * A layout effect writes every level's geometry before the paint, so a rectangle that just
 * appeared never shows its empty first state. Then one `requestAnimationFrame` loop runs, and
 * only while some level on show is `moving` (rising below full, or draining): a full level held
 * stays put and costs nothing. Each frame reads `performance.now()` and the reduced-motion query
 * once, and writes an attribute only when its value changed; a hidden tab, which gets no frames,
 * is right again at the next one, because the geometry is a function of the time.
 *
 * The elements are looked up once per change of `levels`, or of `shape`, never per frame. `shape`
 * names which of these rectangles the keyboard draws now (a key's number or its hand letter can
 * appear while the levels are the same), so the lookup is made again when that changes.
 */
export function useKeyLevels(
  svgRef: RefObject<SVGSVGElement | null>,
  levels: KeyLevels,
  geometry: ReadonlyMap<number, KeyGeometry>,
  shape: string,
): void {
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg || levels.size === 0) return;
    // The lookup: every rectangle of a level on show, by key. A level with no rectangle in the
    // drawn range (a dimmed key, a pitch off the keyboard) finds none, and moves nothing.
    const targets = new Map<number, Target>();
    const attributes = ['data-level-for', 'data-clip-for', 'data-hand-clip-for'] as const;
    for (const el of svg.querySelectorAll(attributes.map((a) => `[${a}]`).join(','))) {
      const attribute = attributes.find((a) => el.hasAttribute(a))!;
      const midi = Number(el.getAttribute(attribute));
      const level = levels.get(midi);
      const where = geometry.get(midi);
      if (!level || !where) continue;
      const target = targets.get(midi) ?? { level, geometry: where, movers: [] };
      target.movers.push({
        el,
        scale: attribute === 'data-hand-clip-for' ? where.travel : 1,
        y: NaN,
        height: NaN,
      });
      targets.set(midi, target);
    }
    if (targets.size === 0) return;

    /** Writes every rectangle for `now`; true while some level still changes after it. */
    const paint = (now: number, reduced: boolean): boolean => {
      let again = false;
      for (const { level, geometry: where, movers } of targets.values()) {
        const rect = levelRect(where.black, where.bar, levelAt(level, now, reduced));
        for (const mover of movers) {
          const y = rect.y * mover.scale;
          const height = rect.height * mover.scale;
          if (y !== mover.y) mover.el.setAttribute('y', String(y));
          if (height !== mover.height) mover.el.setAttribute('height', String(height));
          mover.y = y;
          mover.height = height;
        }
        if (moving(level, now, reduced)) again = true;
      }
      return again;
    };

    let frame = 0;
    const step = () => {
      frame = 0;
      if (paint(performance.now(), prefersReducedMotion())) frame = requestAnimationFrame(step);
    };
    if (paint(performance.now(), prefersReducedMotion())) frame = requestAnimationFrame(step);
    return () => {
      if (frame) cancelAnimationFrame(frame);
    };
  }, [svgRef, levels, geometry, shape]);
}
