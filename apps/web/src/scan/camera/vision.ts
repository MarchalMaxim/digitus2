import { reconstructPage } from './reconstruction.js';
export { reconstructPage } from './reconstruction.js';

export interface Point {
  x: number;
  y: number;
}
export interface Frame {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
export type Matrix = readonly number[];
export interface Registration {
  matrix: Matrix;
  inliers: number;
  error: number;
  coverage: number;
}
export interface Capture {
  frame: Frame;
  matrix: Matrix;
}
export function project(matrix: Matrix, point: Point): Point {
  const w = matrix[6]! * point.x + matrix[7]! * point.y + matrix[8]!;
  return {
    x: (matrix[0]! * point.x + matrix[1]! * point.y + matrix[2]!) / w,
    y: (matrix[3]! * point.x + matrix[4]! * point.y + matrix[5]!) / w,
  };
}
function validFrame(frame: Frame): boolean {
  return (
    Number.isInteger(frame.width) &&
    Number.isInteger(frame.height) &&
    frame.width >= 24 &&
    frame.height >= 24 &&
    frame.data.length === frame.width * frame.height * 4
  );
}
function gray(frame: Frame): Float32Array {
  const out = new Float32Array(frame.width * frame.height);
  for (let i = 0; i < out.length; i++)
    out[i] =
      frame.data[i * 4]! * 0.299 + frame.data[i * 4 + 1]! * 0.587 + frame.data[i * 4 + 2]! * 0.114;
  return out;
}
/** Variance of the four-neighbour Laplacian in 8-bit luminance units squared.
 * Call on tracking frames (long edge <=360); >=80 is the acquisition floor. */
export function sharpness(frame: Frame): number {
  if (!validFrame(frame)) return 0;
  const g = gray(frame),
    w = frame.width;
  let sum = 0,
    squares = 0,
    count = 0;
  for (let y = 1; y < frame.height - 1; y += 2)
    for (let x = 1; x < w - 1; x += 2) {
      const i = y * w + x,
        v = g[i - 1]! + g[i + 1]! + g[i - w]! + g[i + w]! - 4 * g[i]!;
      sum += v;
      squares += v * v;
      count++;
    }
  return Math.max(0, squares / count - (sum / count) ** 2);
}
interface Feature extends Point {
  descriptors: Float32Array[];
}
function inRegion(point: Point, region: readonly Point[], margin = 0): boolean {
  return region.every((a, index) => {
    const b = region[(index + 1) % region.length]!;
    return (
      (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x) >=
      margin * Math.hypot(b.x - a.x, b.y - a.y)
    );
  });
}
function regionBounds(frame: Frame, region?: readonly Point[]) {
  const left = region ? Math.min(...region.map((p) => p.x)) : 0;
  const top = region ? Math.min(...region.map((p) => p.y)) : 0;
  return {
    left,
    top,
    width: region ? Math.max(...region.map((p) => p.x)) - left : frame.width,
    height: region ? Math.max(...region.map((p) => p.y)) - top : frame.height,
  };
}
function sample(g: Float32Array, w: number, h: number, x: number, y: number): number {
  x = Math.max(0, Math.min(w - 1.001, x));
  y = Math.max(0, Math.min(h - 1.001, y));
  const ix = Math.floor(x),
    iy = Math.floor(y),
    dx = x - ix,
    dy = y - iy,
    i = iy * w + ix;
  return (
    (g[i]! * (1 - dx) + g[i + 1]! * dx) * (1 - dy) +
    (g[i + w]! * (1 - dx) + g[i + w + 1]! * dx) * dy
  );
}
function features(frame: Frame, region?: readonly Point[]): Feature[] {
  const w = frame.width,
    h = frame.height,
    source = gray(frame),
    g = new Float32Array(source.length);
  // A small low-pass filter gives patch comparisons tolerance to subpixel motion.
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      g[i] =
        (4 * source[i]! + source[i - 1]! + source[i + 1]! + source[i - w]! + source[i + w]!) / 8;
    }
  const candidates: (Point & { score: number })[] = [];
  for (let y = 15; y < h - 15; y++)
    for (let x = 15; x < w - 15; x++) {
      // Keep the descriptor footprint inside the selected paper. Otherwise a
      // corner on its boundary can match the table while the paper is covered.
      if (region && !inRegion({ x, y }, region, 14)) continue;
      let xx = 0,
        yy = 0,
        xy = 0;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const i = (y + dy) * w + x + dx;
          const gx = g[i + 1]! - g[i - 1]!,
            gy = g[i + w]! - g[i - w]!;
          xx += gx * gx;
          yy += gy * gy;
          xy += gx * gy;
        }
      const score = xx * yy - xy * xy - 0.05 * (xx + yy) ** 2;
      if (score > 1e7) candidates.push({ x, y, score });
    }
  candidates.sort((a, b) => b.score - a.score);
  const selected: Feature[] = [],
    cells = new Uint8Array(16),
    bounds = regionBounds(frame, region);
  for (const point of candidates) {
    const cell =
      Math.min(3, Math.floor(((point.y - bounds.top) / bounds.height) * 4)) * 4 +
      Math.min(3, Math.floor(((point.x - bounds.left) / bounds.width) * 4));
    if (
      cells[cell]! >= 20 ||
      selected.some((p) => (p.x - point.x) ** 2 + (p.y - point.y) ** 2 < 49)
    )
      continue;
    const descriptors: Float32Array[] = [];
    for (const scale of [0.85, 1, 1.18])
      for (const angle of [-0.06, 0, 0.06]) {
        const descriptor = new Float32Array(81);
        let sum = 0,
          norm = 0,
          index = 0;
        for (let dy = -4; dy <= 4; dy++)
          for (let dx = -4; dx <= 4; dx++) {
            const value = sample(
              g,
              w,
              h,
              point.x + (dx * Math.cos(angle) - dy * Math.sin(angle)) * 2.7 * scale,
              point.y + (dx * Math.sin(angle) + dy * Math.cos(angle)) * 2.7 * scale,
            );
            descriptor[index++] = value;
            sum += value;
          }
        for (let i = 0; i < descriptor.length; i++) {
          descriptor[i] = descriptor[i]! - sum / 81;
          norm += descriptor[i]! ** 2;
        }
        norm = Math.sqrt(norm);
        for (let i = 0; i < descriptor.length; i++)
          descriptor[i] = descriptor[i]! / Math.max(1, norm);
        descriptors.push(descriptor);
      }
    selected.push({ x: point.x, y: point.y, descriptors });
    cells[cell] = cells[cell]! + 1;
    if (selected.length >= 240) break;
  }
  return selected;
}
interface Match {
  a: Point;
  b: Point;
}
// Least squares in normalized coordinates avoids the conditioning problems of
// fitting a homography directly in full-resolution pixel units.
function homography(matches: Match[], scale: number): number[] | null {
  const normal = Array.from({ length: 8 }, () => new Float64Array(9));
  for (const { a, b } of matches) {
    const x = a.x / scale,
      y = a.y / scale,
      u = b.x / scale,
      v = b.y / scale;
    for (const row of [
      [x, y, 1, 0, 0, 0, -u * x, -u * y, u],
      [0, 0, 0, x, y, 1, -v * x, -v * y, v],
    ]) {
      for (let i = 0; i < 8; i++)
        for (let j = 0; j < 9; j++) normal[i]![j] = normal[i]![j]! + row[i]! * row[j]!;
    }
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++)
      if (Math.abs(normal[row]![col]!) > Math.abs(normal[pivot]![col]!)) pivot = row;
    if (Math.abs(normal[pivot]![col]!) < 1e-10) return null;
    [normal[col], normal[pivot]] = [normal[pivot]!, normal[col]!];
    const divisor = normal[col]![col]!;
    for (let j = col; j < 9; j++) normal[col]![j] = normal[col]![j]! / divisor;
    for (let row = 0; row < 8; row++)
      if (row !== col) {
        const factor = normal[row]![col]!;
        for (let j = col; j < 9; j++)
          normal[row]![j] = normal[row]![j]! - factor * normal[col]![j]!;
      }
  }
  const p = normal.map((row) => row[8]!);
  return [
    p[0]!,
    p[1]!,
    p[2]! * scale,
    p[3]!,
    p[4]!,
    p[5]! * scale,
    p[6]! / scale,
    p[7]! / scale,
    1,
  ];
}
export function registerFrame(
  reference: Frame,
  current: Frame,
  region?: readonly Point[],
): Registration | null {
  if (
    !validFrame(reference) ||
    !validFrame(current) ||
    reference.width !== current.width ||
    reference.height !== current.height ||
    Math.max(reference.width, reference.height) > 360 ||
    sharpness(reference) < 80 ||
    sharpness(current) < 80
  )
    return null;
  if (
    region &&
    (region.length !== 4 ||
      region.some((p, index) => {
        const b = region[(index + 1) % 4]!,
          c = region[(index + 2) % 4]!;
        return (
          !Number.isFinite(p.x) ||
          !Number.isFinite(p.y) ||
          p.x < 0 ||
          p.y < 0 ||
          p.x >= reference.width ||
          p.y >= reference.height ||
          (b.x - p.x) * (c.y - b.y) - (b.y - p.y) * (c.x - b.x) <= 1
        );
      }))
  )
    return null;
  const a = features(reference, region),
    b = features(current);
  if (a.length < 12 || b.length < 12) return null;
  const pairs: Match[] = [],
    bestForB = new Array<number>(b.length).fill(-1),
    scoresForB = new Array<number>(b.length).fill(-Infinity);
  const bests: { index: number; score: number; second: number }[] = [];
  for (let i = 0; i < a.length; i++) {
    let best = -Infinity,
      second = -Infinity,
      index = -1;
    for (let j = 0; j < b.length; j++) {
      const referenceDescriptor = a[i]!.descriptors[4]!,
        currentDescriptors = b[j]!.descriptors;
      let score = 0;
      for (let k = 0; k < 81; k++) score += referenceDescriptor[k]! * currentDescriptors[4]![k]!;
      // Small zoom/rotation variants refine promising pairs. Most unrelated
      // patches can be discarded with a single correlation, keeping live
      // tracking within the acquisition's frame interval on modest devices.
      if (score > 0.5)
        for (let variant = 0; variant < currentDescriptors.length; variant++) {
          if (variant === 4) continue;
          const descriptor = currentDescriptors[variant]!;
          let dot = 0;
          for (let k = 0; k < 81; k++) dot += referenceDescriptor[k]! * descriptor[k]!;
          score = Math.max(score, dot);
        }
      if (score > scoresForB[j]!) {
        scoresForB[j] = score;
        bestForB[j] = i;
      }
      if (score > best) {
        second = best;
        best = score;
        index = j;
      } else second = Math.max(second, score);
    }
    bests.push({ index, score: best, second });
  }
  for (let i = 0; i < a.length; i++) {
    const best = bests[i]!;
    if (
      best.index >= 0 &&
      best.score > 0.78 &&
      1 - best.score < 0.72 * (1 - best.second) &&
      bestForB[best.index] === i
    )
      pairs.push({ a: a[i]!, b: b[best.index]! });
  }
  if (pairs.length < 12) return null;
  let state = 17431;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  let inliers: Match[] = [];
  for (let attempt = 0; attempt < 700; attempt++) {
    const indices = new Set<number>();
    while (indices.size < 4) indices.add(Math.floor(random() * pairs.length));
    const matrix = homography(
      [...indices].map((i) => pairs[i]!),
      360,
    );
    if (!matrix) continue;
    const agree = pairs.filter(({ a, b }) => {
      const p = project(matrix, a);
      return Math.hypot(p.x - b.x, p.y - b.y) < 2.5;
    });
    if (agree.length > inliers.length) inliers = agree;
  }
  if (inliers.length < 12 || inliers.length / pairs.length < 0.3) return null;
  const matrix = homography(inliers, 360);
  if (!matrix) return null;
  const xs = inliers.map((p) => p.a.x),
    ys = inliers.map((p) => p.a.y),
    bounds = regionBounds(reference, region);
  const spanX = (Math.max(...xs) - Math.min(...xs)) / bounds.width,
    spanY = (Math.max(...ys) - Math.min(...ys)) / bounds.height;
  const coverage = spanX * spanY;
  const cells = new Set(
    inliers.map(
      ({ a }) =>
        Math.floor(((a.x - bounds.left) / bounds.width) * 3) +
        3 * Math.floor(((a.y - bounds.top) / bounds.height) * 3),
    ),
  );
  if (spanX < 0.3 || spanY < 0.3 || coverage < 0.18 || cells.size < 4) return null;
  const error = Math.sqrt(
    inliers.reduce((sum, { a, b }) => {
      const p = project(matrix, a);
      return sum + (p.x - b.x) ** 2 + (p.y - b.y) ** 2;
    }, 0) / inliers.length,
  );
  // Parallel-phone scope: reject folding, extreme zoom and unstable extrapolation.
  const center = { x: reference.width / 2, y: reference.height / 2 },
    p = project(matrix, center),
    px = project(matrix, { x: center.x + 10, y: center.y }),
    py = project(matrix, { x: center.x, y: center.y + 10 });
  const sx = Math.hypot(px.x - p.x, px.y - p.y) / 10,
    sy = Math.hypot(py.x - p.x, py.y - p.y) / 10;
  if (
    error > 1.6 ||
    sx < 0.7 ||
    sx > 1.4 ||
    sy < 0.7 ||
    sy > 1.4 ||
    (px.x - p.x) * (py.y - p.y) - (px.y - p.y) * (py.x - p.x) <= 0
  )
    return null;
  for (const point of [
    { x: 0, y: 0 },
    { x: reference.width, y: 0 },
    { x: reference.width, y: reference.height },
    { x: 0, y: reference.height },
  ]) {
    const denominator = matrix[6]! * point.x + matrix[7]! * point.y + 1;
    if (denominator < 0.6 || denominator > 1.5) return null;
  }
  return { matrix, inliers: inliers.length, error, coverage };
}
/** The guided camera requires the reference and four distinct captured views.
 * Offline acceptance may use reconstructPage with the real available count. */
export async function mergeCaptures(
  captures: Capture[],
  corners: Point[],
  signal?: AbortSignal,
): Promise<Frame> {
  if (captures.length !== 5) throw new Error('Five captures required');
  return (await reconstructPage(captures, corners, signal)).frame;
}
