import { analyzeStaffGeometry, type StaffGeometry } from './staffGeometry';
import type { Frame } from './vision';

/** How soft a photographed score is where the scanner needs it sharp (issue 162): the width of the
 * staff lines' edges as a fraction of the interline, measured on the frame's own pixels.
 *
 * Each of the five lines of every traced staff is sampled across its width at about 20 columns. The
 * line's equivalent width is the area of its dip below the paper divided by the dip's depth. Blur
 * conserves the area (the ink does not change) and lowers the depth, so for a line blurred by a Gaussian of
 * sigma s the width is 2.5 s, and for a sharp line it is the line's own thickness (about 0.12 of the
 * interline). The paper level comes from the bands just above and below the staff, so neighbouring
 * lines, which overlap once the blur nears a third of the interline, do not flatten the result the
 * way a 10 to 90% rise distance between the lines would. The ratio is independent of zoom, of how dark
 * the ink is and of how many notes the page carries. */
export interface StaffSharpness {
  /** The median equivalent width per interline over every line sample of every staff. */
  value: number;
  /** The softest staff's median. */
  worst: number;
  staves: number;
  /** The median interline, in pixels of the measured frame. */
  interline: number;
  /** Always 1: interline is in the frame's own pixels. */
  scale: 1;
  samples: number;
  /** How the staves were found: on the frame as it is, or with its line contrast raised. */
  traced: 'plain' | 'boosted';
}

const COLUMNS = 20;
const STEP = 0.25;
const MIN_DEPTH = 12;
const MIN_SAMPLES = 20;
// Each gain reaches staves the others miss: the tracer finds a staff blurred to about 0.17 of its
// interline as it is, and up to about 0.3 with its contrast raised.
const BOOST_GAINS = [4, 8, 32] as const;

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/** Bilinear luminance (0..255) of the frame, edges clamped. */
function sampler(frame: Frame): (x: number, y: number) => number {
  const { width, height, data } = frame;
  const at = (x: number, y: number): number => {
    const i = (y * width + x) * 4;
    return data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114;
  };
  return (x, y) => {
    const cx = Math.min(width - 1.001, Math.max(0, x)),
      cy = Math.min(height - 1.001, Math.max(0, y));
    const ix = Math.floor(cx),
      iy = Math.floor(cy),
      tx = cx - ix,
      ty = cy - iy;
    return (
      (at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty) +
      (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty
    );
  };
}

/** The frame at the tracer's own working size (at most 1000 x 1800), box-averaged, with its local
 * contrast raised: an unsharp mask on a box mean about a sixtieth of the width across. The tracer's
 * thresholds are absolute, so a staff blurred to a third of its interline or printed pale falls under
 * them while its lines are still there to be measured; the measure itself reads the original pixels. */
function boosted(frame: Frame, gain: number): { frame: Frame; scale: number } {
  const scale = Math.min(1, 1000 / frame.width, 1800 / frame.height);
  const width = Math.round(frame.width * scale),
    height = Math.round(frame.height * scale);
  const lum = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y / scale),
      y1 = Math.max(y0 + 1, Math.min(frame.height, Math.floor((y + 1) / scale)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x / scale),
        x1 = Math.max(x0 + 1, Math.min(frame.width, Math.floor((x + 1) / scale)));
      let sum = 0;
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * frame.width + xx) * 4;
          sum += frame.data[i]! * 0.299 + frame.data[i + 1]! * 0.587 + frame.data[i + 2]! * 0.114;
        }
      lum[y * width + x] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  const radius = Math.max(6, Math.round(width / 60));
  const across = new Float32Array(lum.length),
    mean = new Float32Array(lum.length);
  for (let y = 0; y < height; y++) {
    let sum = 0,
      count = 0;
    for (let x = -radius; x < width; x++) {
      const add = x + radius,
        drop = x - radius - 1;
      if (add < width) {
        sum += lum[y * width + add]!;
        count++;
      }
      if (drop >= 0) {
        sum -= lum[y * width + drop]!;
        count--;
      }
      if (x >= 0) across[y * width + x] = sum / count;
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0,
      count = 0;
    for (let y = -radius; y < height; y++) {
      const add = y + radius,
        drop = y - radius - 1;
      if (add < height) {
        sum += across[add * width + x]!;
        count++;
      }
      if (drop >= 0) {
        sum -= across[drop * width + x]!;
        count--;
      }
      if (y >= 0) mean[y * width + x] = sum / count;
    }
  }
  const data = new Uint8ClampedArray(lum.length * 4);
  for (let i = 0; i < lum.length; i++) {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = lum[i]! + gain * (lum[i]! - mean[i]!);
    data[i * 4 + 3] = 255;
  }
  return { frame: { width, height, data }, scale };
}

/** A geometry found on a copy of the frame, in the frame's own pixels. */
function unscaled(g: StaffGeometry, frame: Frame, scale: number): StaffGeometry {
  const up = (values: readonly number[]): number[] => values.map((v) => v / scale);
  return {
    width: frame.width,
    height: frame.height,
    xs: up(g.xs),
    targetRows: up(g.targetRows),
    sourceRows: g.sourceRows.map(up),
    staves: g.staves.map((s) => ({
      targetCenter: s.targetCenter / scale,
      targetSpacing: s.targetSpacing / scale,
      sourceCenters: up(s.sourceCenters),
      sourceSpacings: up(s.sourceSpacings),
      coverage: s.coverage,
    })),
    maxDisplacement: g.maxDisplacement / scale,
  };
}

/** The frame's staves, from the frame itself and, when the tracer finds none, from a copy whose line
 * contrast is raised. */
export function traceStaves(
  frame: Frame,
  gains: readonly number[] = BOOST_GAINS,
): { geometry: StaffGeometry; traced: 'plain' | 'boosted' } | null {
  const plain = analyzeStaffGeometry(frame);
  if (plain) return { geometry: plain, traced: 'plain' };
  for (const gain of gains) {
    const raised = boosted(frame, gain);
    const geometry = analyzeStaffGeometry(raised.frame);
    if (geometry) return { geometry: unscaled(geometry, frame, raised.scale), traced: 'boosted' };
  }
  return null;
}

/** The sharpness of a frame's staff lines, or null when no staff is traced or no line can be measured.
 * Pass the frame's `traceStaves` when it is already at hand. */
export function staffSharpness(
  frame: Frame,
  tracing?: ReturnType<typeof traceStaves>,
): StaffSharpness | null {
  const found = tracing === undefined ? traceStaves(frame) : tracing;
  if (!found || found.geometry.xs.length < 3) return null;
  const { geometry: g, traced } = found;
  const lum = sampler(frame);
  const across = (x: number, y: number): number => (lum(x - 1, y) + lum(x, y) + lum(x + 1, y)) / 3;
  const first = g.xs[1]!,
    last = g.xs[g.xs.length - 2]!;
  const all: number[] = [];
  const perStaff: number[] = [];
  const spacings: number[] = [];
  for (const staff of g.staves) {
    const values: number[] = [];
    for (let column = 0; column < COLUMNS; column++) {
      const x = first + ((last - first) * column) / (COLUMNS - 1);
      // Linear interpolation of the traced centre and spacing between the trace's columns.
      let k = 0;
      while (k < g.xs.length - 2 && g.xs[k + 1]! < x) k++;
      const t = (x - g.xs[k]!) / (g.xs[k + 1]! - g.xs[k]!);
      const center = staff.sourceCenters[k]! * (1 - t) + staff.sourceCenters[k + 1]! * t;
      const d = staff.sourceSpacings[k]! * (1 - t) + staff.sourceSpacings[k + 1]! * t;
      // The paper: the brightest pixel in the bands 0.8 to 1.2 interlines beyond the outer lines; the
      // darker side wins, so a shadow edge or a neighbouring staff cannot raise it.
      const bright = (from: number, to: number): number => {
        let best = 0;
        for (let y = from; y <= to; y += STEP * 2) best = Math.max(best, across(x, y));
        return best;
      };
      const paper = Math.min(
        bright(center - 2 * d - 1.2 * d, center - 2 * d - 0.8 * d),
        bright(center + 2 * d + 0.8 * d, center + 2 * d + 1.2 * d),
      );
      for (let line = -2; line <= 2; line++) {
        const y = center + line * d;
        const count = Math.round(d / STEP);
        const unit = d / count;
        let min = Infinity,
          at = 0,
          sum = 0;
        for (let i = 0; i <= count; i++) {
          const v = across(x, y - d / 2 + i * unit);
          sum += i === 0 || i === count ? v / 2 : v;
          if (v < min) {
            min = v;
            at = i;
          }
        }
        if (Math.abs(at - count / 2) * unit > 0.25 * d) continue;
        const depth = paper - min;
        if (depth < MIN_DEPTH) continue;
        const area = (paper * count - sum) * unit;
        if (area <= 0) continue;
        values.push(area / depth / d);
      }
    }
    if (values.length < MIN_SAMPLES) continue;
    all.push(...values);
    perStaff.push(median(values));
    spacings.push(staff.targetSpacing);
  }
  if (!perStaff.length) return null;
  return {
    value: median(all),
    worst: Math.max(...perStaff),
    staves: perStaff.length,
    interline: median(spacings),
    scale: 1,
    samples: all.length,
    traced,
  };
}
