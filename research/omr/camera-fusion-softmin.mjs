// Google PhotoScan's composition as a drop-in for apps/web/src/scan/camera/fusion.ts `fuseViews`,
// for the camera-fusion benchmark (research/omr/camera-fusion.mjs) only; the app never loads it.
//
// PhotoScan (https://research.google/blog/photoscan-taking-glare-free-pictures-of-pictures/)
// registers four frames to a reference (homography, then flow on a coarse grid) and takes, per
// output pixel, a soft minimum: "the expectation of the minimum brightness over the registered
// frames", with lower weight near the warped image borders so no seam shows. The blog gives
// neither the exact soft minimum nor the border weighting, so this module implements:
//
//   v = sum_i w_i v_i exp(-(v_i - min v)/T) / sum_i w_i exp(-(v_i - min v)/T)
//   w_i = c_i * f_i
//
// where v_i is view i's exposure-normalised luminance at the pixel, c_i the weight the camera's
// own sampler gives it (registration confidence times the highlight-clip factor, exactly what the
// app's fusion receives), and f_i a border feather: the view's coverage mask blurred by a tent
// of radius 2 * FEATHER_RADIUS, mapped as clamp(2q - 1, 0, 1), so the weight falls linearly to
// zero over about FEATHER_RADIUS * 2 pixels inside the edge of a view's warped coverage (radius 4,
// the same validity feather as fusion.ts, so a narrow hole in a view's registration support does
// not drop the view there; a wider feather left all-glare islands in the result). T is the
// softness in grey levels (T -> 0 is the hard minimum, T -> infinity the weighted mean); the
// benchmark sets it with setSoftness(). The registration, exposure normalisation and sampling are
// the camera's own (the benchmark swaps only this function), so only the composition differs.
//
// Unlike the app's banded fuseViews, this keeps every row in memory (a research tool).

let softness = 8;
export const FEATHER_RADIUS = 4;
export function setSoftness(value) {
  if (!(value > 0)) throw new Error('softness must be positive');
  softness = value;
}
export function getSoftness() {
  return softness;
}

function boxRows(src, dst, width, height, r) {
  const n = 2 * r + 1;
  for (let y = 0; y < height; y++) {
    const o = y * width;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[o + Math.max(0, Math.min(width - 1, k))];
    for (let x = 0; x < width; x++) {
      dst[o + x] = sum / n;
      sum += src[o + Math.min(width - 1, x + r + 1)] - src[o + Math.max(0, x - r)];
    }
  }
}
function boxColumns(src, dst, width, height, r) {
  const n = 2 * r + 1;
  const sum = new Float64Array(width);
  const row = (y) => Math.max(0, Math.min(height - 1, y)) * width;
  for (let k = -r; k <= r; k++) {
    const o = row(k);
    for (let x = 0; x < width; x++) sum[x] += src[o + x];
  }
  for (let y = 0; y < height; y++) {
    const o = y * width,
      add = row(y + r + 1),
      drop = row(y - r);
    for (let x = 0; x < width; x++) {
      dst[o + x] = sum[x] / n;
      sum[x] += src[add + x] - src[drop + x];
    }
  }
}
/** A separable tent of radius 2r (two box passes per axis), edges replicated. */
function tent(a, width, height, r) {
  const t = new Float32Array(a.length);
  boxRows(a, t, width, height, r);
  boxRows(t, a, width, height, r);
  boxColumns(a, t, width, height, r);
  boxColumns(t, a, width, height, r);
}

export async function fuseViews(width, height, count, sample, write, signal) {
  if (signal?.aborted) throw new DOMException('Processing aborted', 'AbortError');
  const size = width * height;
  const values = Array.from({ length: count }, () => new Float32Array(size));
  const weights = Array.from({ length: count }, () => new Float32Array(size));
  const rowValues = Array.from({ length: count }, () => new Float64Array(width));
  const rowWeights = Array.from({ length: count }, () => new Float32Array(width));
  for (let y = 0; y < height; y++) {
    for (let v = 0; v < count; v++) rowWeights[v].fill(0);
    sample(y, rowValues, rowWeights);
    for (let v = 0; v < count; v++) {
      values[v].set(rowValues[v], y * width);
      weights[v].set(rowWeights[v], y * width);
    }
  }
  // Border feather per view (the reference covers the whole output: no feather).
  const feather = [null];
  for (let v = 1; v < count; v++) {
    const q = new Float32Array(size);
    for (let k = 0; k < size; k++) q[k] = weights[v][k] > 0 ? 1 : 0;
    tent(q, width, height, FEATHER_RADIUS);
    for (let k = 0; k < size; k++) q[k] = Math.max(0, Math.min(1, 2 * q[k] - 1));
    feather.push(q);
  }
  const fused = new Float64Array(width),
    admitted = new Uint8Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = y * width + x;
      let low = Infinity;
      for (let v = 0; v < count; v++) {
        const w = v === 0 ? weights[0][k] : weights[v][k] * feather[v][k];
        if (w > 0 && values[v][k] < low) low = values[v][k];
      }
      admitted[x] = 0;
      if (low === Infinity) {
        fused[x] = values[0][k];
        continue;
      }
      let total = 0,
        sum = 0;
      for (let v = 0; v < count; v++) {
        const w = v === 0 ? weights[0][k] : weights[v][k] * feather[v][k];
        if (!(w > 0)) continue;
        const a = w * Math.exp(-(values[v][k] - low) / softness);
        total += a;
        sum += a * values[v][k];
        if (a > 0.1 * w) admitted[x] |= 1 << v;
      }
      fused[x] = sum / total;
    }
    write(
      y,
      fused,
      admitted,
      values.map((a) => Float64Array.from(a.subarray(y * width, (y + 1) * width))),
    );
    if (y % 256 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (signal?.aborted) throw new DOMException('Processing aborted', 'AbortError');
    }
  }
}
