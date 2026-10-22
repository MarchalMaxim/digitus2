import { project, type Matrix, type Point } from './vision.js';

/**
 * The sweep (issue 149): after the first photograph the reader drifts the phone over the page, and
 * a view is taken whenever it pauses, sharp, somewhere new. `point` is where the reference
 * photograph's centre lands in the camera picture now: two views are as far apart as their points.
 */
export interface Sweep {
  /** When the current pause began, or null while the phone moves or the page is lost. */
  since: number | null;
  last: number;
  point: Point | null;
  /** The pause is far enough from every view already taken to become the next one. */
  fresh: boolean;
  /** It has lasted PAUSE_MS: take the view. */
  ready: boolean;
  /** Bad updates in a row during a pause: one is forgiven, the next ends the pause. */
  misses: number;
}
export const initialSweep = (): Sweep => ({
  since: null,
  last: -Infinity,
  point: null,
  fresh: false,
  ready: false,
  misses: 0,
});

/** A convex, ordered page that fills enough of the photograph to be followed as it moves. */
export function validCorners(corners: readonly Point[], width: number, height: number): boolean {
  if (
    corners.length !== 4 ||
    corners.some(
      (point) =>
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        point.x < 0 ||
        point.y < 0 ||
        point.x >= width ||
        point.y >= height,
    )
  )
    return false;
  let area = 0;
  for (let index = 0; index < 4; index++) {
    const a = corners[index]!;
    const b = corners[(index + 1) % 4]!;
    const c = corners[(index + 2) % 4]!;
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <= 1) return false;
    if (Math.hypot(b.x - a.x, b.y - a.y) < Math.min(width, height) * 0.15) return false;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2 >= width * height * 0.2;
}

/**
 * How the sweep judges the view, as fractions of the frame's shorter half. A hand shakes and
 * drifts: it pauses while the view moves at most `steady` between two updates, and a pause makes
 * a new view `apart` from every view taken. The still itself must be `distinct`: one steady step
 * less, since the phone may move on that much while it is taken. Fusion registers every view again.
 */
export function sweepRadii(center: Point) {
  const half = Math.min(center.x, center.y);
  const steady = Math.max(5, half * 0.08);
  const apart = half * 0.2;
  return { steady, apart, distinct: Math.max(0, apart - steady) };
}

/** The circle in the middle of the picture, as a fraction of its shorter half. */
export const CIRCLE = 0.1;

/** How long the phone must pause at a new place before that view is taken. */
export const PAUSE_MS = 300;

/** The shortest gap between two camera images that still counts as one unbroken look. */
export const CONTINUITY_MS = 350;
/** The longest: a picture older than this is stale, however slow the phone. */
export const MAX_CONTINUITY_MS = 1500;
/**
 * How long one camera image may stand for the next, from how often this phone has been
 * delivering them (the gaps between recent updates, in ms): two and a half typical gaps, so a
 * slow phone, whose every update takes longer, can still pause, between CONTINUITY_MS and
 * MAX_CONTINUITY_MS.
 */
export function continuityWindow(gaps: readonly number[]): number {
  if (!gaps.length) return CONTINUITY_MS;
  const sorted = [...gaps].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  const median =
    sorted.length % 2 ? sorted[Math.floor(middle)]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return Math.min(MAX_CONTINUITY_MS, Math.max(CONTINUITY_MS, median * 2.5));
}

/**
 * One tracking update of the sweep. Elapsed time is evidence only when consecutive camera images
 * stay sharp and nearly still. `now` is when the image was taken; `views` are the points of the
 * views already taken (the first photograph's is the centre); `window` is the longest gap between
 * two images that still counts as continuous (continuityWindow; CONTINUITY_MS when absent).
 */
export function sweepStep(
  state: Sweep,
  input: {
    now: number;
    point: Point | null;
    center: Point;
    sharp: boolean;
    views: readonly Point[];
    window?: number;
  },
): Sweep {
  const { now, point, center, sharp, views, window = CONTINUITY_MS } = input;
  const radii = sweepRadii(center);
  const inTime = now > state.last && now - state.last <= Math.min(MAX_CONTINUITY_MS, window);
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !sharp) {
    // One bad update (a blurred or lost frame) does not end a pause; the next one decides. It
    // never completes a view.
    if (state.since !== null && state.misses < 1 && inTime)
      return { ...state, ready: false, last: now, misses: state.misses + 1 };
    return { ...initialSweep(), last: now };
  }
  const still =
    !!state.point &&
    inTime &&
    Math.hypot(point.x - state.point.x, point.y - state.point.y) <= radii.steady;
  const since = still ? (state.since ?? now) : now;
  const fresh = views.every(
    (view) => Math.hypot(point.x - view.x, point.y - view.y) >= radii.apart,
  );
  return {
    since,
    last: now,
    point,
    fresh,
    ready: fresh && now - since >= PAUSE_MS,
    misses: 0,
  };
}

/** Where the reference photograph's centre lands in a view registered by `matrix`. */
export const viewPoint = (matrix: Matrix, center: Point): Point => project(matrix, center);

/** S H S^-1 for equal-aspect tracking and still canvases. */
export function scaledMatrix(matrix: Matrix, scaleX: number, scaleY = scaleX): Matrix {
  return [
    matrix[0]!,
    (matrix[1]! * scaleX) / scaleY,
    matrix[2]! * scaleX,
    (matrix[3]! * scaleY) / scaleX,
    matrix[4]!,
    matrix[5]! * scaleY,
    matrix[6]! / scaleX,
    matrix[7]! / scaleY,
    matrix[8]!,
  ];
}

/** Recheck the actual still before keeping it; a preview match alone is insufficient. */
export function validView({
  matrix,
  previous,
  center,
  sharp,
}: {
  matrix: Matrix | null;
  previous: Matrix[];
  center: Point;
  sharp: boolean;
}): boolean {
  if (!matrix || !sharp) return false;
  const radii = sweepRadii(center);
  const location = viewPoint(matrix, center);
  if (!Number.isFinite(location.x) || !Number.isFinite(location.y)) return false;
  return previous.every((other) => {
    const prior = viewPoint(other, center);
    return Math.hypot(location.x - prior.x, location.y - prior.y) >= radii.distinct;
  });
}
