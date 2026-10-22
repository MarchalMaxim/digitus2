import type { Frame, Matrix, Point } from './vision.js';

interface Gray {
  width: number;
  height: number;
  data: Float32Array;
}
export interface LocalAnchor extends Point {
  dx: number;
  dy: number;
  confidence: number;
  error: number;
}
export interface LocalAlignment {
  /** Reference pixels -> current pixels, before the local correction. */
  matrix: Matrix;
  region: readonly Point[];
  hull: readonly Point[];
  width: number;
  height: number;
  currentWidth: number;
  currentHeight: number;
  cols: number;
  rows: number;
  displacementX: Float32Array;
  displacementY: Float32Array;
  supported: Uint8Array;
  cellAnchors: readonly (readonly number[])[];
  anchors: readonly LocalAnchor[];
  diagnostics: {
    candidates: number;
    matches: number;
    coverage: number;
    medianCorrelation: number;
    residual90: number;
  };
}
function abort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Processing aborted', 'AbortError');
}
/** Lets the page breathe about every 25 ms. Browsers clamp a nested zero timeout to 4 ms or
 * more, so yielding after a fixed count of steps spent much of the work idle. */
function pacer(signal?: AbortSignal) {
  let last = performance.now();
  return async () => {
    abort(signal);
    if (performance.now() - last < 25) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    abort(signal);
    last = performance.now();
  };
}
function project(h: Matrix, x: number, y: number): Point {
  const d = h[6]! * x + h[7]! * y + h[8]!;
  return { x: (h[0]! * x + h[1]! * y + h[2]!) / d, y: (h[3]! * x + h[4]! * y + h[5]!) / d };
}
function inside(region: readonly Point[], x: number, y: number): boolean {
  let result = false;
  for (let i = 0, j = region.length - 1; i < region.length; j = i++) {
    const a = region[i]!,
      b = region[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}
function hull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a: Point, b: Point, c: Point) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const lower: Point[] = [],
    upper: Point[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0)
      lower.pop();
    lower.push(p);
  }
  for (const p of sorted.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0)
      upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
function sample(g: Gray, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= g.width - 1 || y >= g.height - 1) return NaN;
  const ix = Math.floor(x),
    iy = Math.floor(y),
    dx = x - ix,
    dy = y - iy,
    i = iy * g.width + ix;
  return (
    (g.data[i]! * (1 - dx) + g.data[i + 1]! * dx) * (1 - dy) +
    (g.data[i + g.width]! * (1 - dx) + g.data[i + g.width + 1]! * dx) * dy
  );
}
function luminance(frame: Frame): Gray {
  const data = new Float32Array(frame.width * frame.height);
  for (let i = 0; i < data.length; i++)
    data[i] =
      frame.data[i * 4]! * 0.299 + frame.data[i * 4 + 1]! * 0.587 + frame.data[i * 4 + 2]! * 0.114;
  return { width: frame.width, height: frame.height, data };
}
function down(g: Gray): Gray {
  const width = Math.floor(g.width / 2),
    height = Math.floor(g.height / 2),
    data = new Float32Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * 2 * g.width + x * 2;
      data[y * width + x] =
        (g.data[i]! + g.data[i + 1]! + g.data[i + g.width]! + g.data[i + g.width + 1]!) / 4;
    }
  return { width, height, data };
}
function smooth(g: Gray): Gray {
  const data = new Float32Array(g.data.length).fill(NaN);
  for (let y = 1; y < g.height - 1; y++)
    for (let x = 1; x < g.width - 1; x++) {
      let value = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          value += g.data[(y + dy) * g.width + x + dx]! * (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1);
      data[y * g.width + x] = value / 16;
    }
  return { ...g, data };
}
interface Peak {
  x: number;
  y: number;
  score: number;
  unique: number;
}
/** Zero-mean NCC: shadows and exposure offsets cannot manufacture a match. */
function match(
  a: Gray,
  b: Gray,
  x: number,
  y: number,
  cx: number,
  cy: number,
  search: number,
  radius: number,
  subpixel = false,
): Peak | null {
  const count = (2 * radius + 1) ** 2,
    values = new Float64Array(count);
  let sum = 0,
    norm = 0;
  for (let oy = -radius, i = 0; oy <= radius; oy++)
    for (let ox = -radius; ox <= radius; ox++) {
      const v = sample(a, x + ox, y + oy);
      if (!Number.isFinite(v)) return null;
      values[i++] = v;
      sum += v;
    }
  const mean = sum / count;
  for (let i = 0; i < count; i++) {
    values[i] = values[i]! - mean;
    norm += values[i]! ** 2;
  }
  if (norm < count * 36) return null;
  // sample()'s arithmetic, inlined: every offset in the window is a whole pixel, so all share
  // one fraction (coordinates here are dyadic, so px + ox splits exactly as px does). A sample
  // outside the image, or a NaN in the data, makes the score -1 as before.
  const score = (px: number, py: number) => {
    if (
      px - radius < 0 ||
      py - radius < 0 ||
      px + radius >= b.width - 1 ||
      py + radius >= b.height - 1
    )
      return -1;
    const fx = Math.floor(px),
      fy = Math.floor(py),
      dx = px - fx,
      dy = py - fy,
      data = b.data,
      w = b.width;
    let dot = 0,
      total = 0,
      squares = 0,
      i = 0;
    for (let oy = -radius; oy <= radius; oy++)
      for (let ox = -radius, k = (fy + oy) * w + fx - radius; ox <= radius; ox++, k++) {
        const v =
          (data[k]! * (1 - dx) + data[k + 1]! * dx) * (1 - dy) +
          (data[k + w]! * (1 - dx) + data[k + w + 1]! * dx) * dy;
        dot += values[i++]! * v;
        total += v;
        squares += v * v;
      }
    if (dot !== dot || squares !== squares) return -1;
    return dot / Math.sqrt(Math.max(1, norm * (squares - (total * total) / count)));
  };
  const peaks: Peak[] = [];
  let best: Peak = { x: cx, y: cy, score: -1, unique: 0 };
  for (let oy = -search; oy <= search; oy++)
    for (let ox = -search; ox <= search; ox++) {
      const peak = { x: cx + ox, y: cy + oy, score: score(cx + ox, cy + oy), unique: 0 };
      peaks.push(peak);
      if (peak.score > best.score) best = peak;
    }
  let second = -1;
  for (const p of peaks)
    if (Math.hypot(p.x - best.x, p.y - best.y) > 2.5) second = Math.max(second, p.score);
  if (Math.abs(best.x - cx) >= search || Math.abs(best.y - cy) >= search) return null;
  if (subpixel) {
    const bx = best.x,
      by = best.y;
    for (let oy = -0.75; oy <= 0.75; oy += 0.25)
      for (let ox = -0.75; ox <= 0.75; ox += 0.25) {
        const s = score(bx + ox, by + oy);
        if (s > best.score) best = { x: bx + ox, y: by + oy, score: s, unique: 0 };
      }
  }
  return { ...best, unique: best.score - second };
}
function weights(x: number, y: number, width: number, height: number, cols: number, rows: number) {
  const gx = Math.max(0, Math.min(cols - 1.001, (x / width) * (cols - 1))),
    gy = Math.max(0, Math.min(rows - 1.001, (y / height) * (rows - 1)));
  const ix = Math.floor(gx),
    iy = Math.floor(gy),
    dx = gx - ix,
    dy = gy - iy;
  return {
    indices: [iy * cols + ix, iy * cols + ix + 1, (iy + 1) * cols + ix, (iy + 1) * cols + ix + 1],
    values: [(1 - dx) * (1 - dy), dx * (1 - dy), (1 - dx) * dy, dx * dy],
    cell: iy * (cols - 1) + ix,
  };
}
function fit(
  anchors: readonly LocalAnchor[],
  width: number,
  height: number,
  cols: number,
  rows: number,
) {
  const count = cols * rows,
    equations = Array.from({ length: count }, () => new Map<number, number>()),
    bx = new Float64Array(count),
    by = new Float64Array(count);
  const add = (i: number, j: number, v: number) =>
    equations[i]!.set(j, (equations[i]!.get(j) ?? 0) + v);
  for (const p of anchors) {
    const w = weights(p.x, p.y, width, height, cols, rows),
      strength = p.confidence ** 2;
    for (let i = 0; i < 4; i++) {
      const ni = w.indices[i]!,
        wi = w.values[i]! * strength;
      bx[ni] = bx[ni]! + wi * p.dx;
      by[ni] = by[ni]! + wi * p.dy;
      for (let j = 0; j < 4; j++) add(ni, w.indices[j]!, wi * w.values[j]!);
    }
  }
  // A membrane prior regularizes only the displacement; the measured camera
  // perspective stays in the homography. It cannot invent supported coverage.
  for (let i = 0; i < count; i++) {
    add(i, i, 0.0001);
    for (const j of [i % cols < cols - 1 ? i + 1 : -1, i + cols < count ? i + cols : -1])
      if (j >= 0) {
        add(i, i, 0.035);
        add(j, j, 0.035);
        add(i, j, -0.035);
        add(j, i, -0.035);
      }
  }
  const dx = new Float32Array(count),
    dy = new Float32Array(count);
  for (let pass = 0; pass < 140; pass++)
    for (let i = 0; i < count; i++) {
      let sx = bx[i]!,
        sy = by[i]!;
      for (const [j, v] of equations[i]!)
        if (j !== i) {
          sx -= v * dx[j]!;
          sy -= v * dy[j]!;
        }
      const diagonal = equations[i]!.get(i)!;
      dx[i] = sx / diagonal;
      dy[i] = sy / diagonal;
    }
  return { dx, dy };
}
function interpolate(grid: Float32Array, w: ReturnType<typeof weights>): number {
  return w.indices.reduce((sum, i, k) => sum + grid[i]! * w.values[k]!, 0);
}
function quantile(values: number[], fraction: number) {
  values.sort((a, b) => a - b);
  return values[Math.floor((values.length - 1) * fraction)] ?? 0;
}

/** Spatial view registration. All exported coordinates are original pixels.
 * Work images are capped at 1200 pixels on the long edge, independent of input.
 * An unsupported region always falls back to the reference in the caller. */
export async function alignLocalView(
  reference: Frame,
  current: Frame,
  initialMatrix: Matrix,
  region: readonly Point[],
  signal?: AbortSignal,
): Promise<LocalAlignment> {
  abort(signal);
  const valid = (f: Frame) =>
    Number.isInteger(f.width) &&
    Number.isInteger(f.height) &&
    f.width >= 48 &&
    f.height >= 48 &&
    f.width * f.height <= 5_000_000 &&
    f.data.length === f.width * f.height * 4;
  if (
    !valid(reference) ||
    !valid(current) ||
    initialMatrix.length !== 9 ||
    !initialMatrix.every(Number.isFinite) ||
    region.length < 3 ||
    !region.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
  )
    throw new Error('Local alignment invalid input');
  let denominatorSign = 0;
  for (const p of region) {
    const denominator = initialMatrix[6]! * p.x + initialMatrix[7]! * p.y + initialMatrix[8]!;
    if (!denominatorSign) denominatorSign = Math.sign(denominator);
    const q = project(initialMatrix, p.x, p.y),
      qx = project(initialMatrix, p.x + 1, p.y),
      qy = project(initialMatrix, p.x, p.y + 1);
    const determinant = (qx.x - q.x) * (qy.y - q.y) - (qx.y - q.y) * (qy.x - q.x);
    if (
      Math.sign(denominator) !== denominatorSign ||
      !Number.isFinite(determinant) ||
      determinant < 0.1 ||
      determinant > 8
    )
      throw new Error('Local alignment unstable perspective');
  }
  const scale = Math.min(1, 1200 / Math.max(reference.width, reference.height)),
    width = Math.floor(reference.width * scale),
    height = Math.floor(reference.height * scale);
  const referenceGray = luminance(reference),
    currentGray = luminance(current);
  let a: Gray = { width, height, data: new Float32Array(width * height) },
    b: Gray = { width, height, data: new Float32Array(width * height) };
  const pause = pacer(signal);
  for (let y = 0; y < height; y++) {
    if (y % 16 === 0) await pause();
    for (let x = 0; x < width; x++) {
      a.data[y * width + x] = sample(referenceGray, x / scale, y / scale);
      const q = project(initialMatrix, x / scale, y / scale);
      b.data[y * width + x] = sample(currentGray, q.x, q.y);
    }
  }
  a = smooth(a);
  b = smooth(b);
  const aa = [a, down(a)],
    bb = [b, down(b)];
  aa.push(down(aa[1]!));
  bb.push(down(bb[1]!));
  const candidates: Point[] = [],
    step = 36;
  // One two-dimensional corner in each tile. Staff-line-only patches cannot
  // become anchors, even though their correlation can be deceptively high.
  for (let top = 28; top < height - 28; top += step)
    for (let left = 28; left < width - 28; left += step) {
      let best = 0,
        candidate: Point | null = null;
      for (let y = top; y < Math.min(top + step, height - 28); y += 2)
        for (let x = left; x < Math.min(left + step, width - 28); x += 2) {
          if (!inside(region, x / scale, y / scale)) continue;
          let xx = 0,
            yy = 0,
            xy = 0;
          for (let dy = -2; dy <= 2; dy++)
            for (let dx = -2; dx <= 2; dx++) {
              const i = (y + dy) * width + x + dx,
                gx = a.data[i + 1]! - a.data[i - 1]!,
                gy = a.data[i + width]! - a.data[i - width]!;
              xx += gx * gx;
              yy += gy * gy;
              xy += gx * gy;
            }
          const score = (xx * yy - xy * xy) / Math.max(1, xx + yy);
          if (score > best && score > 1000) {
            best = score;
            candidate = { x, y };
          }
        }
      if (candidate) candidates.push(candidate);
    }
  let anchors: LocalAnchor[] = [];
  for (let i = 0; i < candidates.length; i++) {
    await pause();
    const p = candidates[i]!;
    let peak = match(aa[2]!, bb[2]!, p.x / 4, p.y / 4, p.x / 4, p.y / 4, 9, 6);
    if (!peak || peak.score < 0.64 || peak.unique < 0.035) continue;
    peak = match(aa[1]!, bb[1]!, p.x / 2, p.y / 2, peak.x * 2, peak.y * 2, 4, 8);
    if (!peak || peak.score < 0.72) continue;
    peak = match(a, b, p.x, p.y, peak.x * 2, peak.y * 2, 4, 10, true);
    if (!peak || peak.score < 0.8) continue;
    const reverse = match(b, a, peak.x, peak.y, p.x, p.y, 4, 10, true);
    if (!reverse || Math.hypot(reverse.x - p.x, reverse.y - p.y) > 0.8) continue;
    anchors.push({
      x: p.x / scale,
      y: p.y / scale,
      dx: (peak.x - p.x) / scale,
      dy: (peak.y - p.y) / scale,
      confidence: peak.score,
      error: 0,
    });
  }
  const cols = Math.ceil(width / 65) + 1,
    rows = Math.ceil(height / 65) + 1;
  let grid = fit(anchors, reference.width, reference.height, cols, rows);
  for (let pass = 0; pass < 2; pass++) {
    for (const p of anchors) {
      const w = weights(p.x, p.y, reference.width, reference.height, cols, rows);
      p.error = Math.hypot(interpolate(grid.dx, w) - p.dx, interpolate(grid.dy, w) - p.dy);
    }
    anchors = anchors.filter((p) => p.error * scale < 1.8);
    grid = fit(anchors, reference.width, reference.height, cols, rows);
  }
  // Spread is judged where the page has print to match (issue 147): one system on a blank page
  // has all its anchors in one band, and they align that band as surely.
  const printed =
    candidates.length >= 8 ? candidates.map((p) => ({ x: p.x / scale, y: p.y / scale })) : region;
  const minX = Math.min(...printed.map((p) => p.x)),
    minY = Math.min(...printed.map((p) => p.y));
  const regionWidth = Math.max(1, Math.max(...printed.map((p) => p.x)) - minX),
    regionHeight = Math.max(1, Math.max(...printed.map((p) => p.y)) - minY);
  const occupied = new Set(
    anchors.map(
      (p) =>
        Math.min(3, Math.floor(((p.x - minX) / regionWidth) * 4)) +
        4 * Math.min(3, Math.floor(((p.y - minY) / regionHeight) * 4)),
    ),
  );
  if (
    // Sixteen anchors, or, where little is printed, ten that are most of what there was to match.
    (anchors.length < 16 &&
      !(anchors.length >= 10 && anchors.length / Math.max(1, candidates.length) >= 0.6)) ||
    anchors.length / Math.max(1, candidates.length) < 0.2 ||
    occupied.size < 6
  )
    throw new Error('Local alignment uncertain');
  const supported = new Uint8Array((cols - 1) * (rows - 1)),
    cellAnchors: number[][] = Array.from({ length: supported.length }, () => []);
  const alignment: LocalAlignment = {
    matrix: [...initialMatrix],
    region: region.map((p) => ({ ...p })),
    hull: hull(anchors),
    width: reference.width,
    height: reference.height,
    currentWidth: current.width,
    currentHeight: current.height,
    cols,
    rows,
    displacementX: grid.dx,
    displacementY: grid.dy,
    supported,
    cellAnchors,
    anchors,
    diagnostics: {
      candidates: candidates.length,
      matches: anchors.length,
      coverage: 0,
      medianCorrelation: quantile(
        anchors.map((p) => p.confidence),
        0.5,
      ),
      residual90: quantile(
        anchors.map((p) => p.error),
        0.9,
      ),
    },
  };
  let selectedArea = 0,
    supportedArea = 0;
  for (let y = 0; y < rows - 1; y++)
    for (let x = 0; x < cols - 1; x++) {
      // Coverage belongs to the selected page, independent of its background.
      let selectedFraction = 0;
      for (const oy of [0.125, 0.375, 0.625, 0.875])
        for (const ox of [0.125, 0.375, 0.625, 0.875])
          if (
            inside(
              region,
              ((x + ox) * reference.width) / (cols - 1),
              ((y + oy) * reference.height) / (rows - 1),
            )
          )
            selectedFraction += 1 / 16;
      if (!selectedFraction) continue;
      const px = ((x + 0.5) * reference.width) / (cols - 1),
        py = ((y + 0.5) * reference.height) / (rows - 1),
        radius = 75 / scale;
      // Blank paper has nothing to align by, and no view could improve it: it is not counted.
      if (!candidates.some((c) => Math.hypot(c.x / scale - px, c.y / scale - py) < radius))
        continue;
      selectedArea += selectedFraction;
      const nearby = anchors.filter((p) => Math.hypot(p.x - px, p.y - py) < radius);
      cellAnchors[y * (cols - 1) + x] = anchors.flatMap((p, index) =>
        Math.hypot(p.x - px, p.y - py) < radius ? [index] : [],
      );
      if (nearby.length < 3) continue;
      // Positive, bounded Jacobian at every cell corner prevents local folds.
      let safe = true;
      for (const ox of [0, 1])
        for (const oy of [0, 1]) {
          const qx = ((x + ox) * reference.width) / (cols - 1),
            qy = ((y + oy) * reference.height) / (rows - 1);
          const displacement = (xx: number, yy: number) => {
            const w = weights(xx, yy, alignment.width, alignment.height, cols, rows);
            return { x: xx + interpolate(grid.dx, w), y: yy + interpolate(grid.dy, w) };
          };
          const q = displacement(qx, qy),
            q1 = displacement(qx + 1, qy),
            q2 = displacement(qx, qy + 1),
            det = (q1.x - q.x) * (q2.y - q.y) - (q1.y - q.y) * (q2.x - q.x);
          if (
            det < 0.6 ||
            det > 1.6 ||
            Math.hypot(q1.x - q.x, q1.y - q.y) > 1.5 ||
            Math.hypot(q2.x - q.x, q2.y - q.y) > 1.5
          )
            safe = false;
        }
      if (safe) {
        supported[y * (cols - 1) + x] = 1;
        supportedArea += selectedFraction;
      }
    }
  alignment.diagnostics.coverage = supportedArea / Math.max(Number.EPSILON, selectedArea);
  if (alignment.diagnostics.coverage < 0.15)
    throw new Error('Local alignment insufficient coverage');
  return alignment;
}

/** Reference -> current inverse-sampling map. No extrapolation across holes. Called for every
 * output pixel of every view, so it allocates nothing; the arithmetic is weights' and
 * interpolate's, in the same order. */
export function mapLocalPoint(
  alignment: LocalAlignment,
  p: Point,
): { point: Point; confidence: number } | null {
  if (
    !Number.isFinite(p.x) ||
    !Number.isFinite(p.y) ||
    p.x < 0 ||
    p.y < 0 ||
    p.x >= alignment.width ||
    p.y >= alignment.height ||
    !inside(alignment.region, p.x, p.y) ||
    !inside(alignment.hull, p.x, p.y)
  )
    return null;
  const { cols, rows } = alignment;
  const gx = Math.max(0, Math.min(cols - 1.001, (p.x / alignment.width) * (cols - 1))),
    gy = Math.max(0, Math.min(rows - 1.001, (p.y / alignment.height) * (rows - 1)));
  const ix = Math.floor(gx),
    iy = Math.floor(gy),
    dx = gx - ix,
    dy = gy - iy,
    cell = iy * (cols - 1) + ix;
  if (!alignment.supported[cell]) return null;
  const radius = Math.min(alignment.width / (cols - 1), alignment.height / (rows - 1)) * 0.72;
  // The nearest anchor by squared distance; only its distance needs the square root.
  let best = -1,
    nearest2 = Infinity;
  for (const index of alignment.cellAnchors[cell]!) {
    const a = alignment.anchors[index]!,
      ax = a.x - p.x,
      ay = a.y - p.y,
      d2 = ax * ax + ay * ay;
    if (d2 < nearest2) {
      nearest2 = d2;
      best = index;
    }
  }
  const anchor = alignment.anchors[best];
  const nearest = anchor ? Math.hypot(anchor.x - p.x, anchor.y - p.y) : Infinity;
  if (nearest > radius) return null;
  const i0 = iy * cols + ix,
    w0 = (1 - dx) * (1 - dy),
    w1 = dx * (1 - dy),
    w2 = (1 - dx) * dy,
    w3 = dx * dy;
  const at = (grid: Float32Array) =>
    grid[i0]! * w0 + grid[i0 + 1]! * w1 + grid[i0 + cols]! * w2 + grid[i0 + cols + 1]! * w3;
  const point = project(
    alignment.matrix,
    p.x + at(alignment.displacementX),
    p.y + at(alignment.displacementY),
  );
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    point.x < 1 ||
    point.y < 1 ||
    point.x >= alignment.currentWidth - 2 ||
    point.y >= alignment.currentHeight - 2
  )
    return null;
  return { point, confidence: anchor!.confidence * (1 - (0.3 * nearest) / radius) };
}
