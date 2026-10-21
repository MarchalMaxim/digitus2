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
  return area / 2 >= width * height * 0.2;
}

/** Elapsed time is evidence only when consecutive camera images stay aligned and sharp. */
export function alignmentStep(
  state: Alignment,
  input: {
    now: number;
    point: Point | null;
    center: Point;
    sharp: boolean;
    anchors?: readonly Point[];
  },
): Alignment {
  const { now, point, center, sharp } = input;
  const tolerance = Math.max(7, Math.min(center.x, center.y) * 0.065);
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
    now - state.last <= 350 &&
    Math.hypot(point.x - state.point.x, point.y - state.point.y) <= tolerance * 0.5;
  const since = continuous ? (state.since ?? now) : now;
  return { aligned: true, ready: now - since >= 650, since, last: now, point, anchors };
}

/** Bilinear points stay attached to the edited page, rather than the phone screen. */
export function targetPoints(corners: readonly Point[]): Point[] {
  return [
    [0.25, 0.25],
    [0.75, 0.25],
    [0.75, 0.75],
    [0.25, 0.75],
  ].map(([u = 0, v = 0]) => ({
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
  }));
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
