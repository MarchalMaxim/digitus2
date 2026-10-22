import { project, type Matrix, type Point } from './vision.js';

export interface Alignment {
  aligned: boolean;
  ready: boolean;
  since: number | null;
  last: number;
  point: Point | null;
  anchors: readonly Point[] | null;
  /** Bad updates in a row while aligned: one is forgiven, the next empties the ring. */
  misses: number;
}
export const initialAlignment = (): Alignment => ({
  aligned: false,
  ready: false,
  since: null,
  last: -Infinity,
  point: null,
  anchors: null,
  misses: 0,
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

/**
 * How close the dot must come, as fractions of the frame's shorter half (issue 147). A hand
 * shakes: the dot is caught once it is inside the circle (`enter`, the circle's own radius),
 * the hold lasts while it stays within a wider ring (`hold`), and it may move `steady` between
 * two updates. Each view only has to be distinct and sharp; fusion registers it again.
 */
export const CIRCLE = 0.1;
export function captureRadii(center: Point) {
  const half = Math.min(center.x, center.y);
  return {
    enter: Math.max(7, half * CIRCLE),
    hold: Math.max(10, half * 0.14),
    steady: Math.max(5, half * 0.08),
    /** Two views are distinct when their centres are this far apart. */
    distinct: half * 0.14,
  };
}

/** How long the circle must rest on a dot before that view is photographed (the ring's fill). */
export const HOLD_MS = 550;

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
  const radii = captureRadii(center);
  const inTime = now > state.last && now - state.last <= Math.min(MAX_CONTINUITY_MS, window);
  if (
    !point ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    !sharp ||
    Math.hypot(point.x - center.x, point.y - center.y) > (state.aligned ? radii.hold : radii.enter)
  ) {
    // One bad update (a blurred or lost frame, a twitch past the ring) does not empty the ring;
    // the next one decides. It never completes a view.
    if (state.aligned && state.misses < 1 && inTime)
      return { ...state, ready: false, last: now, misses: state.misses + 1 };
    return { ...initialAlignment(), last: now };
  }
  const anchors = input.anchors ?? null;
  const anchorsStable =
    !anchors ||
    (!!state.anchors &&
      anchors.length === state.anchors.length &&
      anchors.every(
        (anchor, index) =>
          Math.hypot(anchor.x - state.anchors![index]!.x, anchor.y - state.anchors![index]!.y) <=
          radii.steady,
      ));
  const continuous =
    state.point &&
    anchorsStable &&
    inTime &&
    Math.hypot(point.x - state.point.x, point.y - state.point.y) <= radii.steady;
  const since = continuous ? (state.since ?? now) : now;
  return {
    aligned: true,
    ready: now - since >= HOLD_MS,
    since,
    last: now,
    point,
    anchors,
    misses: 0,
  };
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
  // Leave room for both holds to land anywhere inside the hold ring.
  const radii = captureRadii(center);
  const separation = radii.distinct + 2 * radii.hold + 1;
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

/**
 * Where the four dots go (issue 147): on the page, narrowed to its printed part when blank paper
 * fills much of it, so reaching a dot never takes the music out of the picture, which is all the
 * camera can follow. A narrow content box widens about its middle until four distinct dots fit;
 * none at all, or one that fits nowhere, leaves the page's own dots.
 */
export function viewTargets(
  corners: readonly Point[],
  center: Point,
  content?: { left: number; top: number; right: number; bottom: number },
): Point[] {
  const page = targetPoints(corners, center);
  if (!content || page.length !== 4) return page;
  const xs = corners.map((point) => point.x),
    ys = corners.map((point) => point.y);
  const bounds = {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
  const pageWidth = bounds.right - bounds.left,
    pageHeight = bounds.bottom - bounds.top;
  const width = Math.min(pageWidth, content.right - content.left),
    height = Math.min(pageHeight, content.bottom - content.top);
  if (width >= pageWidth * 0.75 && height >= pageHeight * 0.75) return page;
  const middle = {
    x: (Math.max(bounds.left, content.left) + Math.min(bounds.right, content.right)) / 2,
    y: (Math.max(bounds.top, content.top) + Math.min(bounds.bottom, content.bottom)) / 2,
  };
  for (let grow = 1; grow <= 4; grow += 0.25) {
    const w = Math.min(pageWidth, width * grow),
      h = Math.min(pageHeight, height * grow);
    const left = Math.min(Math.max(bounds.left, middle.x - w / 2), bounds.right - w),
      top = Math.min(Math.max(bounds.top, middle.y - h / 2), bounds.bottom - h);
    const box = [
      { x: left, y: top },
      { x: left + w, y: top },
      { x: left + w, y: top + h },
      { x: left, y: top + h },
    ];
    const targets = targetPoints(box, center);
    if (targets.length === 4) return targets;
    if (w === pageWidth && h === pageHeight) break;
  }
  return page;
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
  if (!matrix || !sharp) return false;
  const radii = captureRadii(center);
  const point = project(matrix, target);
  // The still was taken while the hold lasted: anywhere inside the hold ring.
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    Math.hypot(point.x - center.x, point.y - center.y) > radii.hold
  )
    return false;
  const location = project(matrix, center);
  return previous.every((other) => {
    const prior = project(other, center);
    return Math.hypot(location.x - prior.x, location.y - prior.y) >= radii.distinct;
  });
}
