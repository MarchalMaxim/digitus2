/**
 * The page photo's half of the linked review (issue 130): over the photo, a thin gray ring where
 * homr read a note the review asks the reader to check, and an ink frame on the note in hand (the
 * one pointed at in either view, else the selected one). Pointing at the photo names the nearest
 * note homr placed there; a click or tap selects it. Positions are homr's imgpos, in the pixels of
 * the photo as uploaded, which is the image's natural size, so the drawing scales with the image.
 */
import type { PointerEvent as ReactPointerEvent } from 'react';
import { FRAME_SPACES } from './crop.js';

export interface PhotoPoint {
  ordinal: number;
  x: number;
  y: number;
}

/**
 * A ring's radius and a pointer's reach, in staff spaces. homr's position is good to about one and
 * a half staff spaces (research/omr/imgpos.mjs), so the ring is drawn wide enough to hold the note.
 */
export const RING_SPACES = 2;
export const REACH_SPACES = 2;

/** The point nearest `at` within `reach`, or undefined. */
export function nearestPoint(
  points: readonly PhotoPoint[],
  at: { x: number; y: number },
  reach: number,
): PhotoPoint | undefined {
  let best: PhotoPoint | undefined;
  let distance = reach;
  for (const p of points) {
    const d = Math.hypot(p.x - at.x, p.y - at.y);
    if (d <= distance) {
      best = p;
      distance = d;
    }
  }
  return best;
}

export function PhotoMarks({
  width,
  height,
  space,
  points,
  marked,
  focus,
  onPoint,
  onPick,
}: {
  /** The photo's natural size, the pixels imgpos is in. */
  width: number;
  height: number;
  /** The page's staff space in those pixels. */
  space: number;
  /** Every note homr placed on this page: what pointing can reach. */
  points: readonly PhotoPoint[];
  /** The notes to check. */
  marked: ReadonlySet<number>;
  /** The note in hand, framed in ink. */
  focus: number | null;
  onPoint(ordinal: number | null): void;
  onPick(ordinal: number): void;
}) {
  const toImage = (event: ReactPointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (!box.width || !box.height) return undefined;
    return {
      x: ((event.clientX - box.left) / box.width) * width,
      y: ((event.clientY - box.top) / box.height) * height,
    };
  };
  const reach = REACH_SPACES * space;
  const framed = focus === null ? undefined : points.find((p) => p.ordinal === focus);
  const side = FRAME_SPACES * space;
  return (
    <svg
      className="scan-photo-marks"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      onPointerMove={(event) => {
        if (event.pointerType !== 'mouse') return;
        const at = toImage(event);
        onPoint(at ? (nearestPoint(points, at, reach)?.ordinal ?? null) : null);
      }}
      onPointerLeave={() => onPoint(null)}
      onClick={(event) => {
        const at = toImage(event as unknown as ReactPointerEvent<SVGSVGElement>);
        const hit = at && nearestPoint(points, at, reach);
        if (hit) onPick(hit.ordinal);
      }}
    >
      {points
        .filter((p) => marked.has(p.ordinal))
        .map((p) => (
          <circle
            key={p.ordinal}
            className="scan-photo-mark"
            cx={p.x}
            cy={p.y}
            r={RING_SPACES * space}
          />
        ))}
      {framed && (
        <rect
          className="scan-photo-focus"
          x={framed.x - side / 2}
          y={framed.y - side / 2}
          width={side}
          height={side}
        />
      )}
    </svg>
  );
}
