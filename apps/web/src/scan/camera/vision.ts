import { estimatePageGeometry } from './pageGeometry.js';

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
function features(frame: Frame): Feature[] {
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
    cells = new Uint8Array(16);
  for (const point of candidates) {
    const cell =
      Math.min(3, Math.floor((point.y / h) * 4)) * 4 + Math.min(3, Math.floor((point.x / w) * 4));
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
export function registerFrame(reference: Frame, current: Frame): Registration | null {
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
  const a = features(reference),
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
    ys = inliers.map((p) => p.a.y);
  const spanX = (Math.max(...xs) - Math.min(...xs)) / reference.width,
    spanY = (Math.max(...ys) - Math.min(...ys)) / reference.height;
  const coverage = spanX * spanY;
  const cells = new Set(
    inliers.map(
      ({ a }) =>
        Math.floor((a.x / reference.width) * 3) + 3 * Math.floor((a.y / reference.height) * 3),
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
function abort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Processing aborted', 'AbortError');
}
function inside(frame: Frame, p: Point) {
  return (
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    p.x >= 0 &&
    p.y >= 0 &&
    p.x <= frame.width - 1 &&
    p.y <= frame.height - 1
  );
}
function luminance(frame: Frame, p: Point): number {
  return smoothLuminance(frame, p.x, p.y);
}
function smoothLuminance(frame: Frame, x: number, y: number): number {
  x = Math.max(0, Math.min(frame.width - 1, x));
  y = Math.max(0, Math.min(frame.height - 1, y));
  const ix = Math.floor(x),
    iy = Math.floor(y),
    dx = x - ix,
    dy = y - iy;
  const at = (px: number, py: number) => {
    const i = (py * frame.width + px) * 4;
    return frame.data[i]! * 0.299 + frame.data[i + 1]! * 0.587 + frame.data[i + 2]! * 0.114;
  };
  return (
    (at(ix, iy) * (1 - dx) + at(Math.min(ix + 1, frame.width - 1), iy) * dx) * (1 - dy) +
    (at(ix, Math.min(iy + 1, frame.height - 1)) * (1 - dx) +
      at(Math.min(ix + 1, frame.width - 1), Math.min(iy + 1, frame.height - 1)) * dx) *
      dy
  );
}
function hasPaperAround(frame: Frame, p: Point): boolean {
  const radius = Math.max(4, Math.ceil((Math.max(frame.width, frame.height) / 360) * 4));
  let paper = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++)
      if (dx || dy) {
        const q = { x: p.x + dx * radius, y: p.y + dy * radius };
        if (inside(frame, q) && luminance(frame, q) >= 210) paper++;
      }
  return paper >= 6;
}
function trackingCopy(frame: Frame): Frame {
  const scale = Math.min(1, 360 / Math.max(frame.width, frame.height)),
    width = Math.round(frame.width * scale),
    height = Math.round(frame.height * scale),
    data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const left = (x * frame.width) / width,
        right = ((x + 1) * frame.width) / width,
        top = (y * frame.height) / height,
        bottom = ((y + 1) * frame.height) / height;
      let sum = 0;
      // Area averaging avoids aliasing thin staves/stems when the full image
      // happens to be an exact multiple of the tracking dimensions.
      for (let sy = Math.floor(top); sy < Math.ceil(bottom); sy++)
        for (let sx = Math.floor(left); sx < Math.ceil(right); sx++) {
          const weight =
            (Math.min(sx + 1, right) - Math.max(sx, left)) *
            (Math.min(sy + 1, bottom) - Math.max(sy, top));
          const si = (sy * frame.width + sx) * 4;
          sum +=
            (frame.data[si]! * 0.299 + frame.data[si + 1]! * 0.587 + frame.data[si + 2]! * 0.114) *
            weight;
        }
      const value = sum / ((right - left) * (bottom - top)),
        i = (y * width + x) * 4;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  return { width, height, data };
}
async function refineCapture(
  reference: Frame,
  capture: Capture,
  points: Feature[],
  tracking: Frame,
  signal?: AbortSignal,
): Promise<Capture> {
  const scaleX = reference.width / tracking.width,
    scaleY = reference.height / tracking.height,
    scale = Math.max(scaleX, scaleY),
    radius = Math.ceil(scale * 3) + 2,
    matches: Match[] = [];
  for (let index = 0; index < points.length; index += 3) {
    if (index % 15 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      abort(signal);
    }
    const feature = points[index]!,
      a = { x: (feature.x + 0.5) * scaleX - 0.5, y: (feature.y + 0.5) * scaleY - 0.5 };
    const base = project(capture.matrix, a);
    if (
      base.x < radius + 12 ||
      base.y < radius + 12 ||
      base.x >= reference.width - radius - 12 ||
      base.y >= reference.height - radius - 12
    )
      continue;
    const template: number[] = [],
      positions: Point[] = [];
    let mean = 0,
      norm = 0;
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const p = { x: a.x + dx * 2, y: a.y + dy * 2 },
          value = smoothLuminance(reference, p.x, p.y);
        template.push(value);
        mean += value;
        positions.push(project(capture.matrix, p));
      }
    mean /= 81;
    for (let i = 0; i < 81; i++) {
      template[i] = template[i]! - mean;
      norm += template[i]! ** 2;
    }
    if (norm < 81 * 20 ** 2) continue;
    const score = (ox: number, oy: number) => {
      let dot = 0,
        sum = 0,
        squares = 0;
      for (let i = 0; i < 81; i++) {
        const p = positions[i]!,
          value = smoothLuminance(capture.frame, p.x + ox, p.y + oy);
        dot += template[i]! * value;
        sum += value;
        squares += value * value;
      }
      return dot / Math.sqrt(Math.max(1, norm * (squares - (sum * sum) / 81)));
    };
    let best = score(0, 0),
      bx = 0,
      by = 0;
    for (let oy = -radius; oy <= radius; oy += 2)
      for (let ox = -radius; ox <= radius; ox += 2) {
        const value = score(ox, oy);
        if (
          value > best + 1e-9 ||
          (Math.abs(value - best) < 1e-9 && ox * ox + oy * oy < bx * bx + by * by)
        ) {
          best = value;
          bx = ox;
          by = oy;
        }
      }
    const coarseX = bx,
      coarseY = by;
    for (let oy = coarseY - 1.5; oy <= coarseY + 1.5; oy += 0.5)
      for (let ox = coarseX - 1.5; ox <= coarseX + 1.5; ox += 0.5) {
        const value = score(ox, oy);
        if (
          value > best + 1e-9 ||
          (Math.abs(value - best) < 1e-9 && ox * ox + oy * oy < bx * bx + by * by)
        ) {
          best = value;
          bx = ox;
          by = oy;
        }
      }
    if (best > 0.93 && Math.abs(bx) < radius && Math.abs(by) < radius)
      matches.push({ a, b: { x: base.x + bx, y: base.y + by } });
  }
  if (matches.length < 12) throw new Error('Full-resolution alignment unavailable');
  let state = 6171,
    inliers: Match[] = [];
  for (let attempt = 0; attempt < 250; attempt++) {
    const indices = new Set<number>();
    while (indices.size < 4) {
      state = (state * 1664525 + 1013904223) >>> 0;
      indices.add(Math.floor((state / 4294967296) * matches.length));
    }
    const matrix = homography(
      [...indices].map((i) => matches[i]!),
      Math.max(reference.width, reference.height),
    );
    if (!matrix) continue;
    const agree = matches.filter(({ a, b }) => {
      const p = project(matrix, a);
      return Math.hypot(p.x - b.x, p.y - b.y) < 1;
    });
    if (agree.length > inliers.length) inliers = agree;
  }
  if (inliers.length < 12 || inliers.length / matches.length < 0.6)
    throw new Error('Full-resolution alignment uncertain');
  const matrix = homography(inliers, Math.max(reference.width, reference.height));
  if (!matrix) throw new Error('Full-resolution alignment failed');
  const xs = inliers.map(({ a }) => a.x),
    ys = inliers.map(({ a }) => a.y);
  if (
    (Math.max(...xs) - Math.min(...xs)) / reference.width < 0.35 ||
    (Math.max(...ys) - Math.min(...ys)) / reference.height < 0.35
  )
    throw new Error('Full-resolution matches too concentrated');
  return { frame: capture.frame, matrix };
}
/** Rectify flat paper. Only replace clipped reference highlights: ordinary
 * notation always comes from the reference, avoiding multi-view edge ghosts. */
export async function mergeCaptures(
  captures: Capture[],
  corners: Point[],
  signal?: AbortSignal,
): Promise<Frame> {
  abort(signal);
  if (captures.length !== 5 || corners.length !== 4)
    throw new Error('Five captures and four corners required');
  const reference = captures[0]!.frame;
  if (!validFrame(reference) || reference.width * reference.height > 5_000_000)
    throw new Error('Unsupported frame size');
  for (const { frame, matrix } of captures) {
    if (
      !validFrame(frame) ||
      frame.width !== reference.width ||
      frame.height !== reference.height ||
      matrix.length !== 9 ||
      matrix.some((v) => !Number.isFinite(v))
    )
      throw new Error('Invalid capture');
    const center = { x: reference.width / 2, y: reference.height / 2 },
      p = project(matrix, center),
      px = project(matrix, { x: center.x + 1, y: center.y }),
      py = project(matrix, { x: center.x, y: center.y + 1 });
    const area = (px.x - p.x) * (py.y - p.y) - (px.y - p.y) * (py.x - p.x);
    if (!Number.isFinite(area) || area < 0.3 || area > 3)
      throw new Error('Invalid capture geometry');
    for (const corner of corners)
      if (matrix[6]! * corner.x + matrix[7]! * corner.y + matrix[8]! <= 0.1)
        throw new Error('Invalid capture projection');
  }
  let geometry = estimatePageGeometry(corners, captures);
  if (Math.max(reference.width, reference.height) > 360) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    abort(signal);
    const tracking = trackingCopy(reference),
      points = features(tracking);
    const refined: Capture[] = [captures[0]!];
    for (let i = 1; i < 5; i++)
      refined.push(await refineCapture(reference, captures[i]!, points, tracking, signal));
    captures = refined;
    geometry = estimatePageGeometry(corners, captures);
  }
  const factor = Math.min(1, 2560 / Math.max(geometry.width, geometry.height)),
    width = Math.round(geometry.width * factor),
    height = Math.round(geometry.height * factor);
  const rect = [
    { x: 0, y: 0 },
    { x: width - 1, y: 0 },
    { x: width - 1, y: height - 1 },
    { x: 0, y: height - 1 },
  ];
  const toReference = homography(
    rect.map((a, i) => ({ a, b: corners[i]! })),
    Math.max(width, height),
  );
  if (!toReference) throw new Error('Invalid page geometry');
  // Each offset must share a substantial, distributed area. Full-page coverage
  // in every moved image would make the four-target acquisition impossible.
  const counts = new Array<number>(5).fill(0);
  for (let gy = 0; gy < 12; gy++)
    for (let gx = 0; gx < 12; gx++) {
      const p = project(toReference, {
        x: ((gx + 0.5) / 12) * (width - 1),
        y: ((gy + 0.5) / 12) * (height - 1),
      });
      let covered = false;
      captures.forEach(({ frame, matrix }, i) => {
        if (inside(frame, project(matrix, p))) {
          counts[i] = counts[i]! + 1;
          covered = true;
        }
      });
      if (!covered) throw new Error('Incomplete page coverage');
    }
  if (counts.some((count) => count < 36)) throw new Error('Insufficient capture overlap');
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    if (y % 24 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      abort(signal);
    }
    for (let x = 0; x < width; x++) {
      const p = project(toReference, { x, y }),
        ref = project(captures[0]!.matrix, p);
      let value = inside(reference, ref) ? luminance(reference, ref) : 255;
      // A 3x3 clipped region is actual glare evidence. Keeping a one-pixel
      // guard around reference ink avoids thickening fine staff lines/stems.
      let clipped = value >= 252;
      if (clipped)
        for (let dy = -1; dy <= 1 && clipped; dy++)
          for (let dx = -1; dx <= 1; dx++)
            if (luminance(reference, { x: ref.x + dx, y: ref.y + dy }) < 252) {
              clipped = false;
              break;
            }
      let darkest = 255,
        second = 255;
      if (clipped)
        for (let i = 1; i < 5; i++) {
          const capture = captures[i]!,
            q = project(capture.matrix, p);
          if (inside(capture.frame, q)) {
            const raw = luminance(capture.frame, q);
            const candidate = raw < 180 && hasPaperAround(capture.frame, q) ? raw : 255;
            if (candidate < darkest) {
              second = darkest;
              darkest = candidate;
            } else second = Math.min(second, candidate);
          }
        }
      // At least two independent moved views must agree. A single shadow,
      // occluder or alignment mistake can never add an extra note.
      if (clipped && second < 180 && second - darkest < 45) value = Math.min(value, second);
      const i = (y * width + x) * 4;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  abort(signal);
  return { width, height, data };
}
