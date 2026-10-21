import { project, type Matrix, type Point } from './vision.js';

export interface Alignment {
  aligned: boolean;
  ready: boolean;
  since: number | null;
  last: number;
  point: Point | null;
  anchors: readonly Point[] | null;
}
export const initialAlignment = (): Alignment => ({
  aligned: false,
  ready: false,
  since: null,
  last: -Infinity,
  point: null,
  anchors: null,
});

/** A convex, ordered page must fill enough of the reference for four distinct views. */
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
  return (
    area / 2 >= width * height * 0.2 &&
    targetPoints(corners, { x: width / 2, y: height / 2 }).length === 4
  );
}

const alignmentTolerance = (center: Point) => Math.max(7, Math.min(center.x, center.y) * 0.065);

/** How long the circle must rest on a dot before that view is photographed (the ring's fill). */
export const HOLD_MS = 650;

/** The shortest gap between two camera images that still counts as one unbroken look. */
export const CONTINUITY_MS = 350;
/** The longest: a picture older than this is stale, however slow the phone. */
export const MAX_CONTINUITY_MS = 1500;
/**
 * How long one camera image may stand for the next, from how often this phone has been
 * delivering them (the gaps between recent updates, in ms): two and a half typical gaps, so a
 * slow phone, whose every update takes longer, can still hold a view, between CONTINUITY_MS and
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
 * Elapsed time is evidence only when consecutive camera images stay aligned and sharp. `now` is
 * when the image was taken; `window` is the longest gap between two images that still counts as
 * continuous (continuityWindow; CONTINUITY_MS when absent).
 */
export function alignmentStep(
  state: Alignment,
  input: {
    now: number;
    point: Point | null;
    center: Point;
    sharp: boolean;
    anchors?: readonly Point[];
    window?: number;
  },
): Alignment {
  const { now, point, center, sharp, window = CONTINUITY_MS } = input;
  const tolerance = alignmentTolerance(center);
  if (
    !point ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    !sharp ||
    Math.hypot(point.x - center.x, point.y - center.y) > tolerance
  )
    return { ...initialAlignment(), last: now };
  const anchors = input.anchors ?? null;
  const anchorsStable =
    !anchors ||
    (!!state.anchors &&
      anchors.length === state.anchors.length &&
      anchors.every(
        (anchor, index) =>
          Math.hypot(anchor.x - state.anchors![index]!.x, anchor.y - state.anchors![index]!.y) <=
          tolerance * 0.5,
      ));
  const continuous =
    state.point &&
    anchorsStable &&
    now > state.last &&
    now - state.last <= Math.min(MAX_CONTINUITY_MS, window) &&
    Math.hypot(point.x - state.point.x, point.y - state.point.y) <= tolerance * 0.5;
  const since = continuous ? (state.since ?? now) : now;
  return { aligned: true, ready: now - since >= HOLD_MS, since, last: now, point, anchors };
}

/** Interior page points must also produce distinct views relative to the reference framing. */
export function targetPoints(corners: readonly Point[], center: Point): Point[] {
  const at = (u: number, v: number): Point => ({
    x:
      corners[0]!.x * (1 - u) * (1 - v) +
      corners[1]!.x * u * (1 - v) +
      corners[2]!.x * u * v +
      corners[3]!.x * (1 - u) * v,
    y:
      corners[0]!.y * (1 - u) * (1 - v) +
      corners[1]!.y * u * (1 - v) +
      corners[2]!.y * u * v +
      corners[3]!.y * (1 - u) * v,
  });
  // Leave room for both holds to land anywhere inside the alignment tolerance.
  const separation = Math.min(center.x, center.y) * 0.16 + 2 * alignmentTolerance(center) + 1;
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const defaults = [at(0.25, 0.25), at(0.75, 0.25), at(0.75, 0.75), at(0.25, 0.75)];
  const distinct = (points: Point[]) =>
    points.every((point, index) =>
      [center, ...points.slice(0, index)].every((prior) => distance(point, prior) >= separation),
    );
  if (distinct(defaults)) return defaults;

  const fractions = [0.15, 0.25, 0.5, 0.75, 0.85];
  const candidates = fractions.flatMap((v) => fractions.map((u) => at(u, v)));
  const selected: Point[] = [];
  while (selected.length < 4) {
    const anchors = [center, ...selected];
    const clearance = (point: Point) => Math.min(...anchors.map((prior) => distance(point, prior)));
    const best = candidates.reduce((a, b) => (clearance(a) >= clearance(b) ? a : b));
    if (clearance(best) < separation) return [];
    selected.push(best);
  }
  return selected;
}

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

/** Recheck the actual still before advancing; a preview match alone is insufficient. */
export function validView({
  matrix,
  previous,
  target,
  center,
  sharp,
}: {
  matrix: Matrix | null;
  previous: Matrix[];
  target: Point;
  center: Point;
  sharp: boolean;
}): boolean {
  if (!matrix) return false;
  const check = alignmentStep(initialAlignment(), {
    now: 0,
    point: project(matrix, target),
    center,
    sharp,
  });
  if (!check.aligned) return false;
  const location = project(matrix, center);
  return previous.every((other) => {
    const prior = project(other, center);
    return (
      Math.hypot(location.x - prior.x, location.y - prior.y) >= Math.min(center.x, center.y) * 0.16
    );
  });
}
