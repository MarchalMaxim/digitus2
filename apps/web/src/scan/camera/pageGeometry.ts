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
    // Both axes must carry perspective signal; otherwise tiny corner errors
    // can create a completely arbitrary finite focal estimate.
    const credible =
      Math.abs(z1) > 0.008 &&
      Math.abs(z2) > 0.008 &&
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
  if (!Number.isFinite(aspectRatio) || aspectRatio < 0.2 || aspectRatio > 5)
    throw new Error('Unsupported page aspect');
  // Keep the reference's natural longest-edge sampling, changing the short
  // edge to the physical aspect when metric recovery is supported.
  const longEdge = Math.max(rawWidth, rawHeight);
  const width = Math.round(longEdge * Math.min(1, aspectRatio)) + 1;
  const height = Math.round(longEdge / Math.max(1, aspectRatio)) + 1;
  return { aspectRatio, method, focalLength, width, height };
}
