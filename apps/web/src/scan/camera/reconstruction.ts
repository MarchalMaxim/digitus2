import type { Capture, Frame, Matrix, Point } from './vision.js';
import { estimatePageGeometry, type PageGeometry } from './pageGeometry.js';
import { alignLocalView, mapLocalPoint, type LocalAlignment } from './localRegistration.js';
import { analyzeStaffGeometry, sourceYAt, type StaffGeometry } from './staffGeometry.js';
import { fuseViews } from './fusion.js';

export interface ReconstructionResult {
  frame: Frame;
  geometry: PageGeometry;
  /** Applied inverse staff mesh, in analysis-image coordinates. */
  staff: StaffGeometry | null;
  alignments: readonly LocalAlignment[];
  /** Per-view pixels whose base agreed with the fusion's consensus of all views.
   * darkSamples counts those where the reference reads at least 65 grey levels below its
   * paper (the page's 90th luminance percentile); shadows also qualify, so this is not a
   * count of preserved musical marks. */
  contributions: { reference: number; views: number[]; darkSamples: number[] };
}
const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
function abort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Processing aborted', 'AbortError');
}
async function yieldFrame(signal?: AbortSignal) {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  abort(signal);
}
function project(h: Matrix, x: number, y: number): Point {
  const d = h[6]! * x + h[7]! * y + h[8]!;
  return { x: (h[0]! * x + h[1]! * y + h[2]!) / d, y: (h[3]! * x + h[4]! * y + h[5]!) / d };
}
function squareToQuad(p: readonly Point[]): Matrix {
  const [a, b, c, d] = p as readonly [Point, Point, Point, Point];
  const dx = a.x - b.x + c.x - d.x,
    dy = a.y - b.y + c.y - d.y;
  const bx = b.x - c.x,
    by = b.y - c.y,
    ex = d.x - c.x,
    ey = d.y - c.y;
  const determinant = bx * ey - ex * by;
  const g = Math.abs(dx) + Math.abs(dy) < 1e-8 ? 0 : (dx * ey - ex * dy) / determinant;
  const h = Math.abs(dx) + Math.abs(dy) < 1e-8 ? 0 : (bx * dy - dx * by) / determinant;
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
function luminance(frame: Frame, x: number, y: number): number {
  x = Math.max(0, Math.min(frame.width - 1, x));
  y = Math.max(0, Math.min(frame.height - 1, y));
  const ix = Math.floor(x),
    iy = Math.floor(y),
    tx = x - ix,
    ty = y - iy;
  const at = (px: number, py: number) => {
    const i = (py * frame.width + px) * 4;
    return frame.data[i]! * 0.299 + frame.data[i + 1]! * 0.587 + frame.data[i + 2]! * 0.114;
  };
  return (
    (at(ix, iy) * (1 - tx) + at(Math.min(ix + 1, frame.width - 1), iy) * tx) * (1 - ty) +
    (at(ix, Math.min(iy + 1, frame.height - 1)) * (1 - tx) +
      at(Math.min(ix + 1, frame.width - 1), Math.min(iy + 1, frame.height - 1)) * tx) *
      ty
  );
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
/** How far p lies inside the view's registered cells: 1 from the centre of a supported cell
 * among supported ones, falling linearly to 0 at the edge of an unsupported cell (the page's
 * own border does not count). Coverage then fades instead of switching, so a photograph whose
 * paper is a shade darker leaves no block or disc edges on the page. */
function support(alignment: LocalAlignment, p: Point): number {
  const { width, height, supported } = alignment,
    cw = alignment.cols - 1,
    ch = alignment.rows - 1;
  const gx = Math.max(0, Math.min(cw - 1, (p.x / width) * cw - 0.5)),
    gy = Math.max(0, Math.min(ch - 1, (p.y / height) * ch - 0.5));
  const ix = Math.min(cw - 2, Math.floor(gx)),
    iy = Math.min(ch - 2, Math.floor(gy)),
    tx = gx - Math.max(0, ix),
    ty = gy - Math.max(0, iy);
  const at = (x: number, y: number) =>
    supported[Math.max(0, Math.min(ch - 1, y)) * cw + Math.max(0, Math.min(cw - 1, x))] ? 1 : 0;
  const x0 = Math.max(0, ix),
    y0 = Math.max(0, iy);
  const s =
    (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) +
    (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
  return Math.max(0, Math.min(1, 2 * s - 1));
}
/** mapLocalPoint, and beyond its anchors' reach (or their hull) inside a supported cell of the
 * page the same smooth displacement field, at a confidence that keeps falling with distance
 * (from 0.7 of the nearest anchor's score down to the cut at 0.35). Glare or defocus leaves the
 * reference without features exactly where the other views are needed; every such sample must
 * still agree with the consensus of all views, and its detail must pass the fusion's own
 * registration check. Both confidences fade to zero at the edge of the registered cells and over
 * the last twentieth of the view's frame before its border. */
function mapView(alignment: LocalAlignment, p: Point): { point: Point; confidence: number } | null {
  const fade = support(alignment, p);
  if (!(fade > 0)) return null;
  // A view centred on part of the page ends at its frame's border: fade towards it too, over
  // a twentieth of the frame.
  const reach = 0.05 * Math.min(alignment.currentWidth, alignment.currentHeight);
  const border = (q: Point) =>
    Math.max(
      0,
      Math.min(
        1,
        (Math.min(q.x, q.y, alignment.currentWidth - 1 - q.x, alignment.currentHeight - 1 - q.y) -
          2) /
          reach,
      ),
    );
  const mapped = mapLocalPoint(alignment, p);
  if (mapped)
    return { point: mapped.point, confidence: mapped.confidence * fade * border(mapped.point) };
  const { width, height, cols, rows } = alignment;
  if (!(p.x >= 0 && p.y >= 0 && p.x < width && p.y < height) || !inside(alignment.region, p.x, p.y))
    return null;
  const gx = Math.max(0, Math.min(cols - 1.001, (p.x / width) * (cols - 1))),
    gy = Math.max(0, Math.min(rows - 1.001, (p.y / height) * (rows - 1)));
  const ix = Math.floor(gx),
    iy = Math.floor(gy),
    tx = gx - ix,
    ty = gy - iy,
    cell = iy * (cols - 1) + ix;
  if (!alignment.supported[cell]) return null;
  const radius = Math.min(width / (cols - 1), height / (rows - 1)) * 0.72;
  let nearest = Infinity,
    confidence = 0;
  for (const index of alignment.cellAnchors[cell]!) {
    const a = alignment.anchors[index]!,
      d = Math.hypot(a.x - p.x, a.y - p.y);
    if (d < nearest) {
      nearest = d;
      confidence = a.confidence;
    }
  }
  confidence *= 0.7 * Math.min(1, radius / nearest);
  if (!(confidence >= 0.35)) return null;
  const at = (grid: Float32Array) => {
    const i = iy * cols + ix;
    return (
      (grid[i]! * (1 - tx) + grid[i + 1]! * tx) * (1 - ty) +
      (grid[i + cols]! * (1 - tx) + grid[i + cols + 1]! * tx) * ty
    );
  };
  const point = project(
    alignment.matrix,
    p.x + at(alignment.displacementX),
    p.y + at(alignment.displacementY),
  );
  if (
    !(point.x >= 1 && point.y >= 1) ||
    point.x >= alignment.currentWidth - 2 ||
    point.y >= alignment.currentHeight - 2
  )
    return null;
  return { point, confidence: confidence * fade * border(point) };
}
/** Catmull-Rom: bilinear sampling halves a one-pixel staff line at a half-pixel offset.
 * Runs for every output pixel of every view, so it allocates nothing. */
function cubic(frame: Frame, x: number, y: number): number {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    tx = x - ix,
    ty = y - iy;
  const x0 = ((2 - tx) * tx - 1) * tx * 0.5,
    x1 = ((3 * tx - 5) * tx * tx + 2) * 0.5,
    x2 = ((4 - 3 * tx) * tx + 1) * tx * 0.5,
    x3 = (tx - 1) * tx * tx * 0.5;
  const { width, height, data } = frame,
    c0 = Math.max(0, Math.min(width - 1, ix - 1)) * 4,
    c1 = Math.max(0, Math.min(width - 1, ix)) * 4,
    c2 = Math.max(0, Math.min(width - 1, ix + 1)) * 4,
    c3 = Math.max(0, Math.min(width - 1, ix + 2)) * 4;
  let value = 0;
  for (let j = 0; j < 4; j++) {
    const o = Math.max(0, Math.min(height - 1, iy - 1 + j)) * width * 4,
      wy =
        j === 0
          ? ((2 - ty) * ty - 1) * ty * 0.5
          : j === 1
            ? ((3 * ty - 5) * ty * ty + 2) * 0.5
            : j === 2
              ? ((4 - 3 * ty) * ty + 1) * ty * 0.5
              : (ty - 1) * ty * ty * 0.5;
    let k = o + c0,
      row = x0 * (data[k]! * 0.299 + data[k + 1]! * 0.587 + data[k + 2]! * 0.114);
    k = o + c1;
    row += x1 * (data[k]! * 0.299 + data[k + 1]! * 0.587 + data[k + 2]! * 0.114);
    k = o + c2;
    row += x2 * (data[k]! * 0.299 + data[k + 1]! * 0.587 + data[k + 2]! * 0.114);
    k = o + c3;
    row += x3 * (data[k]! * 0.299 + data[k + 1]! * 0.587 + data[k + 2]! * 0.114);
    value += wy * row;
  }
  return value;
}
function validate(captures: readonly Capture[], corners: readonly Point[]) {
  if (captures.length < 1 || captures.length > 5) throw new Error('One to five captures required');
  const first = captures[0]!;
  if (first.matrix.length !== 9 || first.matrix.some((v, i) => Math.abs(v - identity[i]!) > 1e-6))
    throw new Error('The first capture must define reference coordinates');
  for (const { frame, matrix } of captures) {
    if (
      !Number.isInteger(frame.width) ||
      !Number.isInteger(frame.height) ||
      frame.width < 24 ||
      frame.height < 24 ||
      frame.width * frame.height > 5_000_000 ||
      frame.data.length !== frame.width * frame.height * 4 ||
      frame.width !== first.frame.width ||
      frame.height !== first.frame.height ||
      matrix.length !== 9 ||
      matrix.some((v) => !Number.isFinite(v))
    )
      throw new Error('Invalid capture');
    const x = frame.width / 2,
      y = frame.height / 2,
      p = project(matrix, x, y),
      px = project(matrix, x + 1, y),
      py = project(matrix, x, y + 1);
    const area = (px.x - p.x) * (py.y - p.y) - (px.y - p.y) * (py.x - p.x);
    if (
      !Number.isFinite(area) ||
      area < 0.3 ||
      area > 3 ||
      corners.some((p) => matrix[6]! * p.x + matrix[7]! * p.y + matrix[8]! <= 0.1)
    )
      throw new Error('Invalid capture geometry');
  }
}
async function planarAnalysis(
  reference: Frame,
  transform: Matrix,
  geometry: PageGeometry,
  signal?: AbortSignal,
) {
  const scale = Math.min(1, 1000 / geometry.width, 1800 / geometry.height);
  const width = Math.max(24, Math.round(geometry.width * scale)),
    height = Math.max(24, Math.round(geometry.height * scale));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    if (y % 64 === 0) await yieldFrame(signal);
    for (let x = 0; x < width; x++) {
      const p = project(transform, x / (width - 1), y / (height - 1)),
        value = luminance(reference, p.x, p.y),
        i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}
function quantile(values: number[], fraction: number) {
  values.sort((a, b) => a - b);
  return values[Math.floor((values.length - 1) * fraction)] ?? 0;
}
/** Normalize only relative exposure between matching photographs. The source's
 * paper/shadows are retained; no thresholding, ink drawing or glare synthesis. */
function exposure(reference: Frame, current: Frame, alignment: LocalAlignment) {
  const a: number[] = [],
    b: number[] = [];
  for (const anchor of alignment.anchors)
    for (const dy of [-3, 0, 3])
      for (const dx of [-3, 0, 3]) {
        const p = { x: anchor.x + dx, y: anchor.y + dy },
          mapped = mapLocalPoint(alignment, p);
        if (!mapped) continue;
        a.push(luminance(reference, p.x, p.y));
        b.push(luminance(current, mapped.point.x, mapped.point.y));
      }
  const al = quantile(a, 0.1),
    ah = quantile(a, 0.9),
    bl = quantile(b, 0.1),
    bh = quantile(b, 0.9);
  const gain = bh - bl > 30 ? Math.max(0.6, Math.min(1.8, (ah - al) / (bh - bl))) : 1;
  return { gain, bias: Math.max(-90, Math.min(90, ah - gain * bh)) };
}

/** Illumination of one photograph against the reference, as a smooth field over the page: a
 * quadratic in the log ratio of their paper levels (the brightest of a small neighbourhood),
 * fitted robustly so that a local glare spot, a hand shadow or clipped paper does not bend it.
 * Vignetting and a light gradient differ between photographs by up to a fifth of the paper's
 * brightness; left in, they decide which photographs outvote which, and the page turns into
 * patches wherever their coverage changes. Returns the factor that brings the view's
 * exposure-normalised value to the reference's light at a reference point. */
function illumination(
  reference: Frame,
  current: Frame,
  alignment: LocalAlignment,
  level: { gain: number; bias: number },
): (p: Point) => number {
  const { width, height } = alignment,
    step = Math.max(8, Math.max(width, height) / 48);
  const paper = (frame: Frame, x: number, y: number) => {
    let best = -Infinity;
    for (let dy = -4; dy <= 4; dy += 2)
      for (let dx = -4; dx <= 4; dx += 2) best = Math.max(best, luminance(frame, x + dx, y + dy));
    return best;
  };
  const rows: number[][] = [],
    targets: number[] = [];
  for (let y = step / 2; y < height; y += step)
    for (let x = step / 2; x < width; x += step) {
      const mapped = mapLocalPoint(alignment, { x, y });
      if (!mapped) continue;
      const r = paper(reference, x, y),
        raw = paper(current, mapped.point.x, mapped.point.y);
      if (!(r >= 60 && r < 250 && raw >= 40 && raw < 250)) continue;
      const v = raw * level.gain + level.bias;
      if (!(v > 20)) continue;
      const u = (2 * x) / width - 1,
        w = (2 * y) / height - 1;
      rows.push([1, u, w, u * u, w * w, u * w]);
      targets.push(Math.log(r / v));
    }
  const c = [0, 0, 0, 0, 0, 0];
  if (rows.length >= 30) {
    // Start from the median ratio, so that a shadow over a quarter of the page is an outlier
    // from the first pass instead of a slope the fit then keeps.
    const median = quantile(targets.slice(), 0.5),
      start = Math.max(
        0.02,
        1.4826 *
          quantile(
            targets.map((t) => Math.abs(t - median)),
            0.5,
          ),
      );
    const weights = targets.map((t) => {
      const r = (t - median) / (4.685 * start);
      return Math.abs(r) < 1 ? (1 - r * r) ** 2 : 0;
    });
    for (let pass = 0; pass < 6; pass++) {
      const a: number[][] = Array.from({ length: 6 }, (_, i) =>
        Array.from({ length: 7 }, (_, j) => (i === j && j < 6 ? 1e-6 : 0)),
      );
      rows.forEach((row, n) => {
        for (let i = 0; i < 6; i++) {
          for (let j = 0; j < 6; j++) a[i]![j] = a[i]![j]! + weights[n]! * row[i]! * row[j]!;
          a[i]![6] = a[i]![6]! + weights[n]! * row[i]! * targets[n]!;
        }
      });
      // Shrink slope and curvature towards none: a few per cent of fitting noise would tip the
      // gates; real vignetting (a fifth of the brightness) stands well above it.
      const mass = weights.reduce((t, q) => t + q, 0);
      for (let i = 1; i < 6; i++) a[i]![i] = a[i]![i]! + 0.15 * mass;
      // Gaussian elimination with partial pivoting.
      for (let i = 0; i < 6; i++) {
        let pivot = i;
        for (let r = i + 1; r < 6; r++)
          if (Math.abs(a[r]![i]!) > Math.abs(a[pivot]![i]!)) pivot = r;
        [a[i], a[pivot]] = [a[pivot]!, a[i]!];
        for (let r = i + 1; r < 6; r++) {
          const f = a[r]![i]! / a[i]![i]!;
          for (let j = i; j < 7; j++) a[r]![j] = a[r]![j]! - f * a[i]![j]!;
        }
      }
      for (let i = 5; i >= 0; i--) {
        let sum = a[i]![6]!;
        for (let j = i + 1; j < 6; j++) sum -= a[i]![j]! * c[j]!;
        c[i] = sum / a[i]![i]!;
      }
      // Tukey's biweight on the residuals: glare and shadows are outliers, not illumination.
      const residuals = rows.map(
        (row, n) => targets[n]! - row.reduce((t, x, i) => t + x * c[i]!, 0),
      );
      const spread = Math.max(0.02, 1.4826 * quantile(residuals.map(Math.abs), 0.5));
      residuals.forEach((r, n) => {
        const t = r / (4.685 * spread);
        weights[n] = Math.abs(t) < 1 ? (1 - t * t) ** 2 : 0;
      });
    }
    if (!c.every(Number.isFinite)) c.fill(0);
  }
  const low = Math.log(0.75),
    high = Math.log(1.33);
  return (p) => {
    const u = (2 * p.x) / width - 1,
      w = (2 * p.y) / height - 1;
    return Math.exp(
      Math.max(
        low,
        Math.min(
          high,
          c[0]! + c[1]! * u + c[2]! * w + c[3]! * u * u + c[4]! * w * w + c[5]! * u * w,
        ),
      ),
    );
  };
}

/** Genuine one-to-five-view reconstruction. Local view registration and staff
 * flattening are distinct maps; composing them avoids repeatedly resampling ink. */
export async function reconstructPage(
  captures: Capture[],
  corners: Point[],
  signal?: AbortSignal,
): Promise<ReconstructionResult> {
  abort(signal);
  validate(captures, corners);
  const reference = captures[0]!.frame;
  let geometry = estimatePageGeometry(corners, captures);
  const transform = squareToQuad(corners);
  await yieldFrame(signal);
  const alignments: LocalAlignment[] = [];
  for (let i = 1; i < captures.length; i++)
    alignments.push(
      await alignLocalView(reference, captures[i]!.frame, captures[i]!.matrix, corners, signal),
    );
  let analysis = await planarAnalysis(reference, transform, geometry, signal);
  let staff = analyzeStaffGeometry(analysis);
  if (staff && staff.maxDisplacement >= 1.5 && geometry.method === 'metric') {
    // A curved sheet does not meet the planar camera-calibration assumptions.
    geometry = estimatePageGeometry(corners, [captures[0]!]);
    analysis = await planarAnalysis(reference, transform, geometry, signal);
    staff = analyzeStaffGeometry(analysis);
  }
  if (staff && staff.maxDisplacement < 1.5) staff = null;
  abort(signal);
  const factor = Math.min(1, 2560 / Math.max(geometry.width, geometry.height));
  const width = Math.round(geometry.width * factor),
    height = Math.round(geometry.height * factor);
  const data = new Uint8ClampedArray(width * height * 4);
  const levels = alignments.map((alignment, index) =>
    exposure(reference, captures[index + 1]!.frame, alignment),
  );
  const lights = alignments.map((alignment, index) =>
    illumination(reference, captures[index + 1]!.frame, alignment, levels[index]!),
  );
  const paper: number[] = [];
  for (let i = 0; i < analysis.data.length; i += 4 * 7) paper.push(analysis.data[i]!);
  const dark = quantile(paper, 0.9) - 65;
  const contributions = {
    reference: width * height,
    views: alignments.map(() => 0),
    darkSamples: alignments.map(() => 0),
  };
  const multiView = captures.length > 1;
  // Clipped highlights only bound the true value from below: glare carries little weight.
  const saturation = (raw: number) => (raw < 250 ? 1 : Math.max(0.05, (255 - raw) / 5));
  await fuseViews(
    width,
    height,
    captures.length,
    (y, values, weights) => {
      for (let x = 0; x < width; x++) {
        const ax = (x / (width - 1)) * (analysis.width - 1),
          ay = (y / (height - 1)) * (analysis.height - 1);
        const sy = staff ? sourceYAt(staff, ax, ay) : ay;
        const p = project(transform, ax / (analysis.width - 1), sy / (analysis.height - 1));
        // One photograph keeps its exact single-capture sampling; fused views all share one
        // kernel, so none gains detail weight from its interpolation alone.
        const original = multiView ? cubic(reference, p.x, p.y) : luminance(reference, p.x, p.y);
        values[0]![x] = original;
        weights[0]![x] = saturation(original);
        for (let view = 0; view < alignments.length; view++) {
          const mapped = mapView(alignments[view]!, p);
          if (!mapped) {
            weights[view + 1]![x] = 0;
            continue;
          }
          const level = levels[view]!,
            raw = cubic(captures[view + 1]!.frame, mapped.point.x, mapped.point.y);
          values[view + 1]![x] = (raw * level.gain + level.bias) * lights[view]!(p);
          weights[view + 1]![x] = mapped.confidence * saturation(raw);
        }
      }
    },
    (y, fused, admitted, values) => {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = fused[x]!;
        data[i + 3] = 255;
        for (let view = 0; view < alignments.length; view++)
          if (admitted[x]! & (2 << view)) {
            contributions.views[view] = contributions.views[view]! + 1;
            if (values[0]![x]! < dark)
              contributions.darkSamples[view] = contributions.darkSamples[view]! + 1;
          }
      }
    },
    signal,
  );
  abort(signal);
  return { frame: { width, height, data }, geometry, staff, alignments, contributions };
}
