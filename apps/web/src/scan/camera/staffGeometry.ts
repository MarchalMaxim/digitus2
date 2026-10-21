import type { Frame } from './vision';

export interface StaffTrace {
  targetCenter: number;
  targetSpacing: number;
  sourceCenters: readonly number[];
  sourceSpacings: readonly number[];
  coverage: number;
}
/** A vertical inverse mesh: output (x,y) samples input (x,sourceYAt(mesh,x,y)).
 * Coordinates are pixels of the supplied, already planar-rectified frame.
 * This recovers straight staff rulings, not a calibrated physical surface. */
export interface StaffGeometry {
  width: number;
  height: number;
  xs: readonly number[];
  targetRows: readonly number[];
  sourceRows: readonly (readonly number[])[];
  staves: readonly StaffTrace[];
  maxDisplacement: number;
}
interface Detection {
  x: number;
  y: number;
  d: number;
  score: number;
}
const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};
const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));

function consistentTrace(track: Detection[]): Detection[] {
  if (track.length >= 30 && new Set(track.map((p) => p.x)).size === track.length) return track;
  // A five-line comb can occasionally lock one space away on a ledger line or
  // slur. Consensus quadratic hypotheses identify these discrete line jumps;
  // the final curve is still fitted locally, not forced to a global parabola.
  let best: Detection[] = [];
  const tolerance = median(track.map((p) => p.d)) * 0.65;
  let seed = 521;
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let trial = 0; trial < 100; trial++) {
    const points = [
      track[Math.floor(random() * track.length)]!,
      track[Math.floor(random() * track.length)]!,
      track[Math.floor(random() * track.length)]!,
    ].sort((a, b) => a.x - b.x);
    if (points[1]!.x - points[0]!.x < 40 || points[2]!.x - points[1]!.x < 40) continue;
    const predict = (x: number): number =>
      points.reduce((sum, p, i) => {
        let term = p.y;
        points.forEach((q, j) => {
          if (i !== j) term *= (x - q.x) / (p.x - q.x);
        });
        return sum + term;
      }, 0);
    const inliers = track.filter((p) => Math.abs(p.y - predict(p.x)) < tolerance);
    if (inliers.length > best.length) best = inliers;
  }
  return best.length >= Math.max(12, track.length * 0.45) ? best : [];
}

function reconnectTracks(tracks: Detection[][], width: number): Detection[][] {
  const groups = tracks.filter((track) => track.length >= 5).map((track) => [...track]);
  // Greedy line following can split a real staff when a hairpin or ledger
  // line temporarily wins the comb score. Join overlapping fragments before
  // consensus: the real continuation then outvotes that transient branch.
  for (let first = 0; first < groups.length; first++) {
    for (let second = first + 1; second < groups.length; second++) {
      const a = groups[first]!,
        b = groups[second]!;
      if (!a.length || !b.length) continue;
      const pairs: [Detection, Detection][] = [];
      for (const p of a) {
        const q = b.find((other) => other.x === p.x);
        if (q) pairs.push([p, q]);
      }
      if (!pairs.length) {
        const endA = a[a.length - 1]!,
          endB = b[b.length - 1]!;
        if (b[0]!.x > endA.x && b[0]!.x - endA.x <= width * 0.08) pairs.push([endA, b[0]!]);
        else if (a[0]!.x > endB.x && a[0]!.x - endB.x <= width * 0.08) pairs.push([a[0]!, endB]);
        else continue;
      }
      const spacing = median([...a, ...b].map((p) => p.d));
      if (Math.max(...pairs.map(([p, q]) => Math.abs(p.y - q.y))) > spacing * 6.5) continue;
      // Adjacent actual staves have disjoint five-line bands. A very short
      // accidental contact between two otherwise separate bands is not enough.
      if (
        pairs.length < 2 &&
        pairs[0]![0].x !== pairs[0]![1].x &&
        Math.abs(pairs[0]![0].y - pairs[0]![1].y) > spacing * 2
      )
        continue;
      groups[first] = [...a, ...b].sort((p, q) => p.x - q.x);
      groups[second] = [];
      second = first;
    }
  }
  return groups.filter((track) => track.length);
}

function luminance(frame: Frame, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const sx = Math.min(frame.width - 1, Math.round((x * frame.width) / width));
      const sy = Math.min(frame.height - 1, Math.round((y * frame.height) / height));
      const i = (sy * frame.width + sx) * 4;
      out[y * width + x] =
        (frame.data[i]! * 0.299 + frame.data[i + 1]! * 0.587 + frame.data[i + 2]! * 0.114) / 255;
    }
  return out;
}

function detect(
  g: Float32Array,
  width: number,
  height: number,
  x: number,
): { detections: Detection[]; precise: Float32Array } {
  const response = new Float32Array(height);
  const precise = new Float32Array(height);
  const radius = Math.max(6, Math.round(width / 100));
  // Vertical local contrast rejects paper shadows; averaging a short horizontal
  // support suppresses stems, letters and isolated note heads.
  for (let y = 3; y < height - 3; y++) {
    let value = 0,
      exact = 0,
      count = 0;
    for (let sx = Math.max(0, x - radius); sx <= Math.min(width - 1, x + radius); sx++) {
      const ink = Math.min(g[y * width + sx]!, g[(y - 1) * width + sx]!, g[(y + 1) * width + sx]!);
      const background = (g[(y - 3) * width + sx]! + g[(y + 3) * width + sx]!) / 2;
      value += Math.max(0, background - ink);
      exact += Math.max(0, background - g[y * width + sx]!);
      count++;
    }
    response[y] = value / count;
    precise[y] = exact / count;
  }
  const at = (y: number): number => {
    const iy = Math.floor(y),
      t = y - iy;
    return (response[iy] ?? 0) * (1 - t) + (response[iy + 1] ?? 0) * t;
  };
  const candidates: Detection[] = [];
  const maximumSpacing = Math.min(24, width / 32);
  for (let d = 4; d <= maximumSpacing; d += 0.5) {
    for (let y = Math.ceil(2 * d + 4); y < height - 2 * d - 4; y++) {
      let sum = 0,
        minimum = 1,
        gaps = 0;
      for (let line = -2; line <= 2; line++) {
        const v = at(y + line * d);
        sum += v;
        minimum = Math.min(minimum, v);
        if (line < 2) gaps += at(y + (line + 0.5) * d);
      }
      const score =
        (sum / 5) * 0.55 +
        minimum * 0.45 -
        (gaps / 4) * 0.65 -
        (at(y - 3 * d) + at(y + 3 * d)) * 0.3;
      if (minimum > 0.06 && score > 0.105) candidates.push({ x, y, d, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const accepted: Detection[] = [];
  for (const candidate of candidates)
    if (
      !accepted.some(
        (other) => Math.abs(other.y - candidate.y) < 3.2 * Math.max(other.d, candidate.d),
      )
    )
      accepted.push(candidate);
  // The tolerant comb above broadens each line by one pixel. Locate each
  // actual contrast peak again before fitting geometry: otherwise that plateau
  // becomes spurious subpixel curvature on a perfectly flat score.
  for (const detection of accepted) {
    const peaks: number[] = [];
    for (let line = -2; line <= 2; line++) {
      const expected = detection.y + line * detection.d;
      let best = Math.round(expected),
        maximum = -1;
      for (let y = Math.ceil(expected - 2); y <= Math.floor(expected + 2); y++) {
        const value = precise[y] ?? 0;
        if (value > maximum) {
          maximum = value;
          best = y;
        }
      }
      // Parabolic peak interpolation keeps genuinely subpixel line positions.
      const left = precise[best - 1] ?? 0,
        right = precise[best + 1] ?? 0;
      const denominator = left - 2 * maximum + right;
      const offset =
        denominator < -1e-6 ? clamp((0.5 * (left - right)) / denominator, -0.5, 0.5) : 0;
      peaks.push(best + offset);
    }
    detection.y = peaks.reduce((sum, value) => sum + value, 0) / 5;
    detection.d = peaks.reduce((sum, value, i) => sum + (i - 2) * value, 0) / 10;
  }
  return { detections: accepted.sort((a, b) => a.y - b.y), precise };
}

function followRulings(
  track: Detection[],
  profiles: Float32Array[],
  xs: number[],
  width: number,
): Detection[] {
  const spacing = median(track.map((p) => p.d)),
    radius = Math.ceil(spacing * 3.5),
    states = radius * 2 + 1;
  const predictions = xs.map((x) => smooth(track, x, 'y', width));
  const strengths: Float32Array[] = [],
    spacings: Float32Array[] = [],
    parents: Int16Array[] = [];
  let previous = new Float64Array(states).fill(0);
  for (let column = 0; column < xs.length; column++) {
    const profile = profiles[column]!,
      at = (y: number): number => {
        const iy = Math.floor(y),
          t = y - iy;
        return (profile[iy] ?? 0) * (1 - t) + (profile[iy + 1] ?? 0) * t;
      };
    const strength = new Float32Array(states),
      ds = new Float32Array(states);
    for (let state = 0; state < states; state++) {
      const center = Math.round(predictions[column]!) + state - radius;
      let best = -Infinity;
      for (let d = spacing - 1; d <= spacing + 1.001; d += 0.25) {
        let sum = 0,
          minimum = 1;
        for (let line = -2; line <= 2; line++) {
          const v = at(center + line * d);
          sum += v;
          minimum = Math.min(minimum, v);
        }
        const score =
          (sum / 5) * 0.6 + minimum * 0.4 - (at(center - 3 * d) + at(center + 3 * d)) * 0.2;
        if (score > best) {
          best = score;
          ds[state] = d;
        }
      }
      strength[state] = Math.max(0, best);
    }
    const normalizer = Math.max(0.08, ...strength),
      costs = new Float64Array(states).fill(Infinity),
      links = new Int16Array(states);
    for (let state = 0; state < states; state++) {
      const observation = -strength[state]! / normalizer + 0.00012 * (state - radius) ** 2;
      for (let delta = -5; delta <= 5; delta++) {
        const from = state + delta;
        if (from < 0 || from >= states) continue;
        const cost = previous[from]! + observation + 0.018 * delta * delta;
        if (cost < costs[state]!) {
          costs[state] = cost;
          links[state] = from;
        }
      }
    }
    strengths.push(strength);
    spacings.push(ds);
    parents.push(links);
    previous = costs;
  }
  let state = previous.indexOf(Math.min(...previous));
  const followed: Detection[] = [];
  for (let column = xs.length - 1; column >= 0; column--) {
    const strength = strengths[column]![state]!,
      d = spacings[column]![state]!;
    if (strength > 0.075) {
      const center = Math.round(predictions[column]!) + state - radius,
        profile = profiles[column]!;
      const peaks: number[] = [];
      for (let line = -2; line <= 2; line++) {
        const expected = center + line * d;
        let best = Math.round(expected),
          maximum = -1;
        for (let y = Math.ceil(expected - 1.5); y <= Math.floor(expected + 1.5); y++)
          if ((profile[y] ?? 0) > maximum) {
            maximum = profile[y]!;
            best = y;
          }
        const left = profile[best - 1] ?? 0,
          right = profile[best + 1] ?? 0,
          denominator = left - 2 * maximum + right;
        peaks.push(
          best + (denominator < -1e-6 ? clamp((0.5 * (left - right)) / denominator, -0.5, 0.5) : 0),
        );
      }
      followed.push({
        x: xs[column]!,
        y: peaks.reduce((a, b) => a + b, 0) / 5,
        d: peaks.reduce((sum, y, i) => sum + y * (i - 2), 0) / 10,
        score: strength,
      });
    }
    state = parents[column]![state]!;
  }
  return followed.reverse();
}

/** Weighted local quadratic regression follows paper bow while rejecting note
 * contamination. The small normal system is solved with pivoting. */
function smooth(track: readonly Detection[], x: number, key: 'y' | 'd', width: number): number {
  const nearestX = clamp(x, track[0]!.x, track[track.length - 1]!.x);
  const bandwidth = width * 0.13;
  const solve = (prediction?: number[]): number[] => {
    const a = Array.from({ length: 3 }, () => [0, 0, 0, 0]);
    for (const point of track) {
      const t = (point.x - nearestX) / bandwidth;
      let weight = Math.exp(-0.5 * t * t) * point.score;
      if (prediction) {
        const residual = point[key] - prediction[0]! - prediction[1]! * t - prediction[2]! * t * t;
        weight /= 1 + (residual / (key === 'y' ? 4 : 0.8)) ** 2;
      }
      const v = [1, t, t * t];
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) a[row]![col]! += weight * v[row]! * v[col]!;
        a[row]![3]! += weight * v[row]! * point[key];
      }
    }
    for (let col = 0; col < 3; col++) {
      let pivot = col;
      for (let row = col + 1; row < 3; row++)
        if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
      [a[col], a[pivot]] = [a[pivot]!, a[col]!];
      const divisor = a[col]![col]!;
      if (Math.abs(divisor) < 1e-8) return [median(track.map((p) => p[key])), 0, 0];
      for (let j = col; j < 4; j++) a[col]![j]! /= divisor;
      for (let row = 0; row < 3; row++)
        if (row !== col) {
          const factor = a[row]![col]!;
          for (let j = col; j < 4; j++) a[row]![j]! -= factor * a[col]![j]!;
        }
    }
    return a.map((row) => row[3]!);
  };
  const fit = solve(),
    refined = solve(fit);
  // At an unobserved page margin, extrapolate only a bounded tangent.
  const nearby = [...track]
    .sort((a, b) => Math.abs(a.x - nearestX) - Math.abs(b.x - nearestX))
    .slice(0, 5);
  const tolerance = key === 'y' ? median(nearby.map((p) => p.d)) * 0.5 : 0.5;
  const supported = clamp(
    refined[0]!,
    Math.min(...nearby.map((p) => p[key])) - tolerance,
    Math.max(...nearby.map((p) => p[key])) + tolerance,
  );
  const extension = clamp((x - nearestX) / bandwidth, -0.6, 0.6);
  const limit = key === 'y' ? median(nearby.map((p) => p.d)) : 0.5;
  return supported + clamp(refined[1]! * extension, -limit, limit);
}

export function analyzeStaffGeometry(frame: Frame): StaffGeometry | null {
  if (
    !Number.isInteger(frame.width) ||
    !Number.isInteger(frame.height) ||
    frame.width < 100 ||
    frame.height < 100 ||
    frame.data.length !== frame.width * frame.height * 4
  )
    return null;
  const scale = Math.min(1, 1000 / frame.width, 1800 / frame.height);
  const width = Math.round(frame.width * scale),
    height = Math.round(frame.height * scale);
  const g = luminance(frame, width, height),
    columns = 45;
  const xs = Array.from({ length: columns }, (_, i) =>
    Math.round(((width - 1) * i) / (columns - 1)),
  );
  const tracks: Detection[][] = [];
  const profiles: Float32Array[] = [];
  for (let column = 0; column < columns; column++) {
    const { detections, precise } = detect(g, width, height, xs[column]!);
    profiles.push(precise);
    const used = new Set<Detection[]>();
    for (const candidate of detections) {
      let best: Detection[] | undefined,
        distance = Infinity;
      for (const track of tracks) {
        const last = track[track.length - 1]!;
        if (
          used.has(track) ||
          candidate.x - last.x > width * 0.095 ||
          Math.abs(candidate.d / last.d - 1) > 0.3
        )
          continue;
        const delta = Math.abs(candidate.y - last.y);
        if (delta < candidate.d * 3 && delta < distance) {
          best = track;
          distance = delta;
        }
      }
      if (best) {
        best.push(candidate);
        used.add(best);
      } else {
        const track = [candidate];
        tracks.push(track);
        used.add(track);
      }
    }
  }
  const selected = reconnectTracks(tracks, width)
    .filter(
      (track) =>
        track.length >= columns * 0.5 && track[track.length - 1]!.x - track[0]!.x > width * 0.55,
    )
    .map(consistentTrace)
    .filter((track) => track.length >= columns * 0.4)
    .map((track) => followRulings(track, profiles, xs, width))
    .filter(
      (track) =>
        track.length >= columns * 0.4 && track[track.length - 1]!.x - track[0]!.x > width * 0.55,
    );
  if (selected.length < 2) return null;
  const staves: StaffTrace[] = selected
    .map((track) => {
      const sourceCenters = xs.map((x) => smooth(track, x, 'y', width) / scale);
      const sourceSpacings = xs.map((x) => clamp(smooth(track, x, 'd', width), 3.5, 25) / scale);
      return {
        sourceCenters,
        sourceSpacings,
        targetCenter: median(sourceCenters),
        targetSpacing: median(sourceSpacings),
        coverage: new Set(track.map((p) => p.x)).size / columns,
      };
    })
    .sort((a, b) => a.targetCenter - b.targetCenter);
  const targetRows = [0];
  const sourceRows: number[][] = xs.map(() => [0]);
  for (const staff of staves)
    for (let line = -2; line <= 2; line++) {
      targetRows.push(staff.targetCenter + line * staff.targetSpacing);
      sourceRows.forEach((rows, column) =>
        rows.push(staff.sourceCenters[column]! + line * staff.sourceSpacings[column]!),
      );
    }
  targetRows.push(frame.height - 1);
  sourceRows.forEach((rows) => rows.push(frame.height - 1));
  let maxDisplacement = 0;
  for (const rows of sourceRows)
    for (let row = 1; row < rows.length; row++) {
      const targetGap = targetRows[row]! - targetRows[row - 1]!;
      const ratio = (rows[row]! - rows[row - 1]!) / targetGap;
      // Fail closed on mistaken/crossing staff associations rather than folding,
      // clipping or compressing notation into a vanishing interval.
      if (targetGap <= 0 || ratio < 0.2 || ratio > 2.8) return null;
      maxDisplacement = Math.max(maxDisplacement, Math.abs(rows[row]! - targetRows[row]!));
    }
  return {
    width: frame.width,
    height: frame.height,
    xs: xs.map((x) => x / scale),
    targetRows,
    sourceRows,
    staves,
    maxDisplacement,
  };
}

export function sourceYAt(geometry: StaffGeometry, x: number, y: number): number {
  const rows = geometry.targetRows;
  let low = 0,
    high = rows.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >>> 1;
    if (rows[middle]! <= y) low = middle;
    else high = middle;
  }
  const xPosition = clamp(
    (x / (geometry.width - 1)) * (geometry.xs.length - 1),
    0,
    geometry.xs.length - 1,
  );
  const column = Math.min(geometry.xs.length - 2, Math.floor(xPosition)),
    tx = xPosition - column;
  const left = geometry.sourceRows[column]!,
    right = geometry.sourceRows[column + 1]!;
  const top = left[low]! * (1 - tx) + right[low]! * tx;
  const bottom = left[high]! * (1 - tx) + right[high]! * tx;
  return top + (bottom - top) * clamp((y - rows[low]!) / (rows[high]! - rows[low]!), 0, 1);
}

export async function dewarpScore(
  frame: Frame,
  signal?: AbortSignal,
): Promise<{ frame: Frame; geometry: StaffGeometry | null; applied: boolean }> {
  signal?.throwIfAborted();
  const geometry = analyzeStaffGeometry(frame);
  if (!geometry || geometry.maxDisplacement < 2.5) return { frame, geometry, applied: false };
  const data = new Uint8ClampedArray(frame.data.length);
  for (let y = 0; y < frame.height; y++) {
    if (y % 64 === 0) {
      signal?.throwIfAborted();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    for (let x = 0; x < frame.width; x++) {
      const sy = sourceYAt(geometry, x, y),
        iy = Math.min(frame.height - 2, Math.floor(sy)),
        t = sy - iy;
      for (let channel = 0; channel < 4; channel++)
        data[(y * frame.width + x) * 4 + channel] =
          frame.data[(iy * frame.width + x) * 4 + channel]! * (1 - t) +
          frame.data[((iy + 1) * frame.width + x) * 4 + channel]! * t;
    }
  }
  return { frame: { width: frame.width, height: frame.height, data }, geometry, applied: true };
}
