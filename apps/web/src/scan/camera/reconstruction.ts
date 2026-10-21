import type { Capture, Frame, Matrix, Point } from './vision.js';
import { estimatePageGeometry, type PageGeometry } from './pageGeometry.js';
import { alignLocalView, mapLocalPoint, type LocalAlignment } from './localRegistration.js';
import { analyzeStaffGeometry, sourceYAt, type StaffGeometry } from './staffGeometry.js';

export interface ReconstructionResult {
  frame: Frame;
  geometry: PageGeometry;
  /** Applied inverse staff mesh, in analysis-image coordinates. */
  staff: StaffGeometry | null;
  alignments: readonly LocalAlignment[];
  /** Per-view sampled pixels. darkSamples counts reference luminance <180;
   * shadows also qualify, so this is not a count of preserved musical marks. */
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
  const contributions = {
    reference: width * height,
    views: alignments.map(() => 0),
    darkSamples: alignments.map(() => 0),
  };
  for (let y = 0; y < height; y++) {
    if (y % 24 === 0) await yieldFrame(signal);
    for (let x = 0; x < width; x++) {
      const ax = (x / (width - 1)) * (analysis.width - 1),
        ay = (y / (height - 1)) * (analysis.height - 1);
      const sy = staff ? sourceYAt(staff, ax, ay) : ay;
      const p = project(transform, ax / (analysis.width - 1), sy / (analysis.height - 1));
      const original = luminance(reference, p.x, p.y);
      let total = original,
        weight = 1;
      for (let view = 0; view < alignments.length; view++) {
        const mapped = mapLocalPoint(alignments[view]!, p);
        if (!mapped || mapped.confidence < 0.65) continue;
        const level = levels[view]!,
          value =
            luminance(captures[view + 1]!.frame, mapped.point.x, mapped.point.y) * level.gain +
            level.bias;
        // Never use conflicting view evidence to add or erase musical marks.
        // The reference has at least half the final weight even with four views.
        if (Math.abs(value - original) > 24) continue;
        const w = 0.25 * mapped.confidence;
        total += value * w;
        weight += w;
        contributions.views[view] = contributions.views[view]! + 1;
        if (original < 180) contributions.darkSamples[view] = contributions.darkSamples[view]! + 1;
      }
      const i = (y * width + x) * 4,
        value = total / weight;
      data[i] = data[i + 1] = data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  abort(signal);
  return { frame: { width, height, data }, geometry, staff, alignments, contributions };
}
