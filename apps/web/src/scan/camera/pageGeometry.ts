interface Point {
  x: number;
  y: number;
}
interface GeometryCapture {
  frame: { width: number; height: number };
  matrix: readonly number[];
}
export interface PageGeometry {
  aspectRatio: number;
  method: 'metric' | 'approximate';
  focalLength: number | null;
  /** Natural output dimensions, including both pixel endpoints; caller caps resolution. */
  width: number;
  height: number;
}
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Unit square -> observed quadrilateral, with h33=1. */
function squareToQuad(p: readonly Point[]): number[] {
  const [a, b, c, d] = p as readonly [Point, Point, Point, Point];
  const dx = a.x - b.x + c.x - d.x,
    dy = a.y - b.y + c.y - d.y;
  let g = 0,
    h = 0;
  if (Math.abs(dx) + Math.abs(dy) > 1e-8) {
    const bx = b.x - c.x,
      by = b.y - c.y,
      dx2 = d.x - c.x,
      dy2 = d.y - c.y;
    const determinant = bx * dy2 - dx2 * by;
    if (Math.abs(determinant) < 1e-8) throw new Error('Invalid page geometry');
    g = (dx * dy2 - dx2 * dy) / determinant;
    h = (bx * dy - dx * by) / determinant;
  }
  return [
    b.x - a.x + g * b.x,
    d.x - a.x + h * d.x,
    a.x,
    b.y - a.y + g * b.y,
    d.y - a.y + h * d.y,
    a.y,
    g,
    h,
    1,
  ];
}

function multiply(a: readonly number[], b: readonly number[]): number[] {
  const result = Array.from({ length: 9 }, (_, i) => {
    const row = Math.floor(i / 3),
      col = i % 3;
    return a[row * 3]! * b[col]! + a[row * 3 + 1]! * b[col + 3]! + a[row * 3 + 2]! * b[col + 6]!;
  });
  return result.map((v) => v / result[8]!);
}

type Interval = readonly [number, number];
const exact = (v: number): Interval => [v, v];
const add = (a: Interval, b: Interval): Interval => [a[0] + b[0], a[1] + b[1]];
const subtract = (a: Interval, b: Interval): Interval => [a[0] - b[1], a[1] - b[0]];
function product(a: Interval, b: Interval): Interval {
  const values = [a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1]];
  return [Math.min(...values), Math.max(...values)];
}
function quotient(a: Interval, b: Interval): Interval {
  return b[0] <= 0 && b[1] >= 0 ? [-Infinity, Infinity] : product(a, [1 / b[1], 1 / b[0]]);
}

/**
 * Enclose the homography for every corner location in the error box. In
 * particular this bounds the vanishing-point coordinates, whose sign must be
 * identifiable before division by their product can calibrate a focal length.
 * Ordinary agreement across views cannot detect this error: every view uses
 * the same manually selected reference corners.
 */
function cornerUncertainty(corners: readonly Point[], radius: number): Interval[] {
  const [a, b, c, d] = corners.map((p) => ({
    x: [p.x - radius, p.x + radius] as Interval,
    y: [p.y - radius, p.y + radius] as Interval,
  })) as [
    { x: Interval; y: Interval },
    { x: Interval; y: Interval },
    { x: Interval; y: Interval },
    { x: Interval; y: Interval },
  ];
  const dx = subtract(add(a.x, c.x), add(b.x, d.x)),
    dy = subtract(add(a.y, c.y), add(b.y, d.y)),
    bx = subtract(b.x, c.x),
    by = subtract(b.y, c.y),
    dx2 = subtract(d.x, c.x),
    dy2 = subtract(d.y, c.y),
    determinant = subtract(product(bx, dy2), product(dx2, by)),
    g = quotient(subtract(product(dx, dy2), product(dx2, dy)), determinant),
    h = quotient(subtract(product(bx, dy), product(dx, by)), determinant);
  return [
    add(subtract(b.x, a.x), product(g, b.x)),
    add(subtract(d.x, a.x), product(h, d.x)),
    a.x,
    add(subtract(b.y, a.y), product(g, b.y)),
    add(subtract(d.y, a.y), product(h, d.y)),
    a.y,
    g,
    h,
    exact(1),
  ];
}

function perspectiveIsObservable(matrix: readonly number[], h: readonly Interval[]): boolean {
  // Homographies have arbitrary scale. No normalization is needed: excluding
  // zero in both homogeneous coordinates is invariant under a common scale.
  return [0, 1].every((column) => {
    const range = add(
      add(product(exact(matrix[6]!), h[column]!), product(exact(matrix[7]!), h[column + 3]!)),
      product(exact(matrix[8]!), h[column + 6]!),
    );
    return Number.isFinite(range[0]) && Number.isFinite(range[1]) && range[0] * range[1] > 0;
  });
}

function aspectIsStable(
  corners: readonly Point[],
  captures: readonly GeometryCapture[],
  radius: number,
  aspect: number,
): boolean {
  const acceptable = (perturbed: Point[]) => {
    try {
      const result = estimateGeometry(perturbed, captures, false);
      // Use the same proportional tolerance as cross-view aspect consensus,
      // symmetrically so swapping page axes cannot change the decision.
      return (
        result.method === 'metric' &&
        Math.max(result.aspectRatio / aspect, aspect / result.aspectRatio) < 1.035
      );
    } catch {
      return false;
    }
  };
  // Probe individual coordinates and every simultaneous sign combination of
  // the eight corner-coordinate errors. Agreement between views alone misses
  // their correlated bias. This is a deterministic sensitivity test, not an
  // interval proof of aspect accuracy; the separate interval guard excludes
  // singular calibrations anywhere inside the localization error box.
  for (let coordinate = 0; coordinate < 8; coordinate++) {
    for (const sign of [-1, 1]) {
      const perturbed = corners.map((p, i) => ({
        x: p.x + (coordinate === 2 * i ? sign * radius : 0),
        y: p.y + (coordinate === 2 * i + 1 ? sign * radius : 0),
      }));
      if (!acceptable(perturbed)) return false;
    }
  }
  for (let bits = 0; bits < 256; bits++) {
    const perturbed = corners.map((p, i) => ({
      x: p.x + (bits & (1 << (2 * i)) ? radius : -radius),
      y: p.y + (bits & (1 << (2 * i + 1)) ? radius : -radius),
    }));
    if (!acceptable(perturbed)) return false;
  }
  return true;
}

/**
 * Flat rectangular paper, pinhole camera, square pixels, zero skew and principal
 * point at frame center. These are explicit assumptions, not camera calibration.
 *
 * For H=[h1 h2 h3] mapping the unit square into a view, K^-1 h1 and K^-1 h2
 * are orthogonal physical page axes. Thus f² = -(a1*a2+b1*b2)/(h1z*h2z),
 * where aj=hjx-cx*hjz, bj=hjy-cy*hjz. Physical W/H is their norm ratio.
 * Derivation: Zhang, section 2.2–2.3, https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/tr98-71.pdf
 * No projective geometry can determine the focal length from parallel frontal
 * views here. Such views return an explicitly approximate observed aspect.
 */
export function estimatePageGeometry(
  corners: readonly Point[],
  captures: readonly GeometryCapture[],
): PageGeometry {
  return estimateGeometry(corners, captures, true);
}

function estimateGeometry(
  corners: readonly Point[],
  captures: readonly GeometryCapture[],
  checkSensitivity: boolean,
): PageGeometry {
  const reference = captures[0]?.frame;
  if (
    !reference ||
    corners.length !== 4 ||
    !Number.isFinite(reference.width) ||
    !Number.isFinite(reference.height) ||
    reference.width < 24 ||
    reference.height < 24
  )
    throw new Error('Invalid page frame');
  for (let i = 0; i < 4; i++) {
    const a = corners[i]!,
      b = corners[(i + 1) % 4]!,
      c = corners[(i + 2) % 4]!;
    if (
      !Number.isFinite(a.x) ||
      !Number.isFinite(a.y) ||
      a.x < 0 ||
      a.y < 0 ||
      a.x > reference.width - 1 ||
      a.y > reference.height - 1 ||
      (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <= 1
    )
      throw new Error('Invalid page corners');
  }
  const length = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const rawWidth = (length(corners[0]!, corners[1]!) + length(corners[3]!, corners[2]!)) / 2;
  const rawHeight = (length(corners[0]!, corners[3]!) + length(corners[1]!, corners[2]!)) / 2;
  if (rawWidth < 23 || rawHeight < 23) throw new Error('Page too small');
  const referenceH = squareToQuad(corners);
  // A 0.2% frame-coordinate error is four pixels in a 2000px source. Keep it
  // proportional to resolution because corners are positioned on a scaled
  // preview, and clamp to at least one source pixel for quantization.
  const radius = Math.max(1, Math.max(reference.width, reference.height) / 500),
    uncertainH = cornerUncertainty(corners, radius);
  const views = captures.map(({ frame, matrix }) => {
    if (
      matrix.length !== 9 ||
      matrix.some((v) => !Number.isFinite(v)) ||
      !Number.isFinite(frame.width) ||
      !Number.isFinite(frame.height) ||
      frame.width < 24 ||
      frame.height < 24
    )
      throw new Error('Invalid page capture');
    const h = multiply(matrix, referenceH),
      cx = frame.width / 2,
      cy = frame.height / 2;
    const x1 = h[0]! - cx * h[6]!,
      y1 = h[3]! - cy * h[6]!,
      z1 = h[6]!;
    const x2 = h[1]! - cx * h[7]!,
      y2 = h[4]! - cy * h[7]!,
      z2 = h[7]!;
    const focalSquared = -(x1 * x2 + y1 * y2) / (z1 * z2),
      size = Math.max(frame.width, frame.height);
    // A point estimate of perspective is insufficient: its entire localization
    // error interval must exclude the unobservable (parallel-axis) case.
    const credible =
      perspectiveIsObservable(matrix, uncertainH) &&
      focalSquared > (size * 0.2) ** 2 &&
      focalSquared < (size * 8) ** 2;
    return { x1, y1, z1, x2, y2, z2, focal: credible ? Math.sqrt(focalSquared) : null };
  });
  let method: PageGeometry['method'] = 'approximate',
    focalLength: number | null = null,
    aspectRatio = rawWidth / rawHeight;
  const candidates = views.flatMap((v) => (v.focal === null ? [] : [v.focal]));
  if (candidates.length >= 2) {
    const center = median(candidates),
      agreeing = candidates.filter((f) => Math.abs(f / center - 1) < 0.15);
    if (agreeing.length >= 2 && agreeing.length >= Math.ceil(candidates.length * 0.6)) {
      const focal = median(agreeing),
        ratios: number[] = [];
      for (const v of views) {
        const n1 = Math.hypot(v.x1 / focal, v.y1 / focal, v.z1),
          n2 = Math.hypot(v.x2 / focal, v.y2 / focal, v.z2);
        const cosine =
          Math.abs((v.x1 * v.x2 + v.y1 * v.y2) / (focal * focal) + v.z1 * v.z2) / (n1 * n2);
        if (cosine < 0.03 && n1 > 0 && n2 > 0) ratios.push(n1 / n2);
      }
      if (ratios.length >= Math.max(2, Math.ceil(views.length * 0.6))) {
        const ratio = median(ratios),
          consistent = ratios.filter((r) => Math.abs(r / ratio - 1) < 0.035);
        if (
          ratio >= 0.2 &&
          ratio <= 5 &&
          consistent.length >= Math.max(2, Math.ceil(views.length * 0.6))
        ) {
          aspectRatio = median(consistent);
          focalLength = focal;
          method = 'metric';
        }
      }
    }
  }
  if (
    method === 'metric' &&
    checkSensitivity &&
    !aspectIsStable(corners, captures, radius, aspectRatio)
  ) {
    method = 'approximate';
    focalLength = null;
    aspectRatio = rawWidth / rawHeight;
  }
  if (!Number.isFinite(aspectRatio) || aspectRatio < 0.2 || aspectRatio > 5)
    throw new Error('Unsupported page aspect');
  // Keep the reference's natural longest-edge sampling, changing the short
  // edge to the physical aspect when metric recovery is supported.
  const longEdge = Math.max(rawWidth, rawHeight);
  const width = Math.round(longEdge * Math.min(1, aspectRatio)) + 1;
  const height = Math.round(longEdge / Math.max(1, aspectRatio)) + 1;
  return { aspectRatio, method, focalLength, width, height };
}
