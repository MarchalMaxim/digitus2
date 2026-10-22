import { analyzeStaffGeometry, type StaffGeometry } from './staffGeometry';
import type { Frame } from './vision';

/** Which way a page is turned, read from its staff lines (issue 165).
 *
 * `turn` is the number of clockwise degrees to apply with Rotate to make the page upright, the
 * same as `quarterTurns * 90` in rotation.ts. A page turned k quarter turns clockwise needs
 * `((4 - k) % 4) * 90`.
 *
 * The axis comes from where `analyzeStaffGeometry` finds staves: it traces horizontal rulings
 * only, so it finds them in the page as given or in the page turned a quarter, not in both. The
 * side comes from the ink in a window at each end of the staves: a staff starts with a clef and
 * a key signature and ends with a barline, so the start carries more ink than the end. The module
 * abstains (null) whenever either cue is missing or weak. */
export type Turn = 0 | 90 | 180 | 270;
export interface Orientation {
  turn: Turn;
  /** In [0, 1]: the smaller of how clearly one axis won and how clearly one end carried the ink. */
  confidence: number;
}

export const ORIENTATION_LIMITS = {
  /** Staves must be found with this much total coverage (the sum of each staff's coverage). */
  minCoverage: 1.0,
  /** The winning axis must find this many times the coverage of the other. */
  axisRatio: 2,
  /** The ends must differ by this share of their combined ink. */
  sideMargin: 0.2,
  /** The heavier end must hold at least this ink fraction, averaged over the staves. */
  minInk: 0.08,
  /** Width of each end window, in staff spaces. */
  window: 4,
  /** Height of each end window above and below the staff's middle line, in staff spaces. */
  band: 2.5,
  /** The staff lines must be at least this much darker than the paper between them. */
  minContrast: 25,
} as const;

type QuarterTurns = 0 | 1 | 2 | 3;

/** The frame turned clockwise by the given number of quarter turns. */
export function rotateFrame(frame: Frame, quarterTurns: QuarterTurns): Frame {
  const { width: w, height: h, data } = frame;
  if (quarterTurns === 0) return frame;
  const swap = quarterTurns !== 2;
  const width = swap ? h : w;
  const height = swap ? w : h;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let sx: number, sy: number;
      if (quarterTurns === 1) {
        sx = y;
        sy = h - 1 - x;
      } else if (quarterTurns === 2) {
        sx = w - 1 - x;
        sy = h - 1 - y;
      } else {
        sx = w - 1 - y;
        sy = x;
      }
      const from = (sy * w + sx) * 4;
      const to = (y * width + x) * 4;
      out[to] = data[from]!;
      out[to + 1] = data[from + 1]!;
      out[to + 2] = data[from + 2]!;
      out[to + 3] = data[from + 3]!;
    }
  return { width, height, data: out };
}

/** Area-averages a large frame down to the size analyzeStaffGeometry works at (1000 by 1800 at
 * most), so that its own nearest-neighbour sampling, which drops thin lines, is the identity. */
export function downscaleForAnalysis(frame: Frame): Frame {
  const scale = Math.min(1, 1000 / frame.width, 1800 / frame.height);
  if (scale >= 1) return frame;
  const width = Math.max(1, Math.min(1000, Math.round(frame.width * scale)));
  const height = Math.max(1, Math.min(1800, Math.round(frame.height * scale)));
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor((y * frame.height) / height);
    const y1 = Math.min(
      frame.height,
      Math.max(y0 + 1, Math.ceil(((y + 1) * frame.height) / height)),
    );
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor((x * frame.width) / width);
      const x1 = Math.min(
        frame.width,
        Math.max(x0 + 1, Math.ceil(((x + 1) * frame.width) / width)),
      );
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = y0; sy < y1; sy++)
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * frame.width + sx) * 4;
          r += frame.data[i]!;
          g += frame.data[i + 1]!;
          b += frame.data[i + 2]!;
          a += frame.data[i + 3]!;
        }
      const n = (y1 - y0) * (x1 - x0);
      const o = (y * width + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = a / n;
    }
  }
  return { width, height, data: out };
}

const median = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};
const quantile = (values: number[], q: number): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
};

/** The ink share in a window at each end of every staff, summed over the staves measured. The
 * geometry's coordinates are the frame's own (the frame is already within the analysis size). */
export function measureSides(
  frame: Frame,
  g: StaffGeometry,
): { left: number; right: number; staves: number } {
  const { width, height, data } = frame;
  const lum = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++)
    lum[i] = data[i * 4]! * 0.299 + data[i * 4 + 1]! * 0.587 + data[i * 4 + 2]! * 0.114;
  const at = (x: number, y: number): number =>
    lum[Math.max(0, Math.min(height - 1, Math.round(y))) * width + x]!;
  const interpolate = (values: readonly number[], x: number): number => {
    const xs = g.xs;
    if (x <= xs[0]!) return values[0]!;
    if (x >= xs[xs.length - 1]!) return values[values.length - 1]!;
    let i = 0;
    while (xs[i + 1]! < x) i++;
    const t = (x - xs[i]!) / (xs[i + 1]! - xs[i]!);
    return values[i]! * (1 - t) + values[i + 1]! * t;
  };
  let left = 0,
    right = 0,
    measured = 0;
  for (const staff of g.staves) {
    const centre = new Float32Array(width),
      spacing = new Float32Array(width);
    for (let x = 0; x < width; x++) {
      centre[x] = interpolate(staff.sourceCenters, x);
      spacing[x] = interpolate(staff.sourceSpacings, x);
    }
    const lineMin: Float32Array[] = [];
    for (let l = 0; l < 5; l++) {
      const row = new Float32Array(width);
      for (let x = 0; x < width; x++) {
        const y = centre[x]! + (l - 2) * spacing[x]!;
        row[x] = Math.min(at(x, y - 1), at(x, y), at(x, y + 1));
      }
      lineMin.push(row);
    }
    const space = new Float32Array(width);
    for (let x = 0; x < width; x++) {
      const v: number[] = [];
      for (let l = -2; l < 2; l++) v.push(at(x, centre[x]! + (l + 0.5) * spacing[x]!));
      v.sort((a, b) => a - b);
      space[x] = (v[1]! + v[2]!) / 2;
    }
    const paper = median(Array.from(space));
    const lines = lineMin.flatMap((row) => Array.from(row));
    // The typical line is the median: notes only darken a line, so a dense staff must not set
    // the level. Ink is the dark end of the same samples.
    const line = median(lines);
    const ink = quantile(lines, 0.05);
    if (paper - line < ORIENTATION_LIMITS.minContrast) continue;
    const threshold = (paper + line) / 2;
    // The staff's own extent: the longest run of columns where the lines are there, bridging
    // short gaps. sourceCenters is extrapolated past the traced range, so it cannot mark this.
    const present = new Uint8Array(width);
    for (let x = 0; x < width; x++) {
      let n = 0;
      for (let l = 0; l < 5; l++) if (lineMin[l]![x]! < threshold) n++;
      present[x] = n >= 4 ? 1 : 0;
    }
    const bridge = 2 * staff.targetSpacing;
    let best: [number, number] | null = null;
    let runStart = -1,
      runEnd = -1;
    for (let x = 0; x < width; x++) {
      if (!present[x]) continue;
      if (runStart >= 0 && x - runEnd <= bridge) runEnd = x;
      else {
        if (runStart >= 0 && (!best || runEnd - runStart > best[1] - best[0]))
          best = [runStart, runEnd];
        runStart = runEnd = x;
      }
    }
    if (runStart >= 0 && (!best || runEnd - runStart > best[1] - best[0]))
      best = [runStart, runEnd];
    if (!best || best[1] - best[0] < 0.5 * width) continue;
    const [start, end] = best;
    const reach = ORIENTATION_LIMITS.window * staff.targetSpacing;
    const band = ORIENTATION_LIMITS.band;
    const fraction = (x0: number, x1: number): number => {
      const columns: number[] = [];
      for (let x = Math.max(0, Math.ceil(x0)); x <= Math.min(width - 1, Math.floor(x1)); x++)
        columns.push(x);
      if (!columns.length) return 0;
      // The window's own paper level, so a shadow is not ink. The start-of-staff glyphs can
      // darken the mid-spaces of the whole window, so the level never falls below halfway
      // between the staff's paper and its dark end.
      const windowPaper = Math.max(median(columns.map((x) => space[x]!)), (paper + ink) / 2);
      const cut = (windowPaper + ink) / 2;
      let dark = 0,
        total = 0;
      for (const x of columns) {
        const c = centre[x]!,
          d = spacing[x]!;
        for (let y = Math.ceil(c - band * d); y <= Math.floor(c + band * d); y++) {
          if (y < 0 || y >= height) continue;
          const nearest = Math.max(-2, Math.min(2, Math.round((y - c) / d)));
          if (Math.abs(y - (c + nearest * d)) <= 1) continue;
          total++;
          if (lum[y * width + x]! < cut) dark++;
        }
      }
      return total ? dark / total : 0;
    };
    left += fraction(start, start + reach - 1);
    right += fraction(end - reach + 1, end);
    measured++;
  }
  return { left, right, staves: measured };
}

const coverage = (g: StaffGeometry | null): number =>
  g ? g.staves.reduce((sum, s) => sum + s.coverage, 0) : 0;

/** What the decision rests on, for the benchmark: the coverage found on the winning and the
 * other axis, and the ink share at each end of the staves. `side` is null when the axis did not
 * decide. */
export interface OrientationEvidence {
  hi: number;
  lo: number;
  staves: number;
  left: number;
  right: number;
  side: number | null;
}

export function readOrientation(frame: Frame): {
  orientation: Orientation | null;
  evidence: OrientationEvidence;
} {
  const { minCoverage, axisRatio, sideMargin, minInk } = ORIENTATION_LIMITS;
  const a = downscaleForAnalysis(frame);
  const b = downscaleForAnalysis(rotateFrame(frame, 1));
  const gA = analyzeStaffGeometry(a);
  const gB = analyzeStaffGeometry(b);
  const covA = coverage(gA),
    covB = coverage(gB);
  const hi = Math.max(covA, covB),
    lo = Math.min(covA, covB);
  const evidence: OrientationEvidence = { hi, lo, staves: 0, left: 0, right: 0, side: null };
  if (hi < minCoverage || hi < axisRatio * lo) return { orientation: null, evidence };
  const aWon = covA >= covB;
  const sides = measureSides(aWon ? a : b, (aWon ? gA : gB)!);
  const { left, right, staves } = sides;
  Object.assign(evidence, { staves, left, right });
  if (staves < 2) return { orientation: null, evidence };
  const side = (left - right) / (left + right + 1e-9);
  evidence.side = side;
  if (Math.max(left, right) / staves < minInk || Math.abs(side) < sideMargin)
    return { orientation: null, evidence };
  const upright = side > 0;
  const turn: Turn = aWon ? (upright ? 0 : 180) : upright ? 90 : 270;
  return {
    orientation: { turn, confidence: Math.min(1 - lo / hi, Math.min(1, Math.abs(side))) },
    evidence,
  };
}

/** The clockwise turn that makes the page upright, or null when the staves or their ends do not
 * say. */
export function detectOrientation(frame: Frame): Orientation | null {
  return readOrientation(frame).orientation;
}
