/** Fills one output row for every view: exposure-normalised luminance and a weight
 * (registration confidence times a saturation factor); weight 0 means no sample. */
export type FusionSampler = (y: number, values: Float64Array[], weights: Float32Array[]) => void;
/** Receives one fused row, a per-pixel bit mask of the views whose base agreed with the
 * consensus, and the row's input values. */
export type FusionWriter = (
  y: number,
  fused: Float64Array,
  admitted: Uint8Array,
  values: readonly Float64Array[],
) => void;

const band = 24,
  baseRadius = 4,
  energyRadius = 2,
  margin = 2 * baseRadius,
  tauBright = 10,
  tauDark = 20,
  cut = 0.02,
  trusted = 0.5,
  floor = 1000,
  power = 6;

function abort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Processing aborted', 'AbortError');
}
async function yieldFrame(signal?: AbortSignal) {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  abort(signal);
}
function boxRows(src: Float32Array, dst: Float32Array, width: number, rows: number, r: number) {
  const n = 2 * r + 1;
  for (let y = 0; y < rows; y++) {
    const o = y * width;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[o + Math.max(0, Math.min(width - 1, k))]!;
    for (let x = 0; x < width; x++) {
      dst[o + x] = sum / n;
      sum += src[o + Math.min(width - 1, x + r + 1)]! - src[o + Math.max(0, x - r)]!;
    }
  }
}
function boxColumns(
  src: Float32Array,
  dst: Float32Array,
  width: number,
  rows: number,
  r: number,
  sum: Float64Array,
) {
  const n = 2 * r + 1,
    row = (y: number) => Math.max(0, Math.min(rows - 1, y)) * width;
  sum.fill(0);
  for (let k = -r; k <= r; k++) {
    const o = row(k);
    for (let x = 0; x < width; x++) sum[x] = sum[x]! + src[o + x]!;
  }
  for (let y = 0; y < rows; y++) {
    const o = y * width,
      add = row(y + r + 1),
      drop = row(y - r);
    for (let x = 0; x < width; x++) {
      dst[o + x] = sum[x]! / n;
      sum[x] = sum[x]! + src[add + x]! - src[drop + x]!;
    }
  }
}
/** Two box passes per axis: a separable tent of radius 2r, edges replicated. */
function blur(
  a: Float32Array,
  t: Float32Array,
  width: number,
  rows: number,
  r: number,
  sum: Float64Array,
) {
  boxRows(a, t, width, rows, r);
  boxRows(t, a, width, rows, r);
  boxColumns(a, t, width, rows, r, sum);
  boxColumns(t, a, width, rows, r, sum);
}

/**
 * Multi-view fusion on the output grid (issue 143): the static form of a Kalman update, each
 * photograph a measurement of one page weighted by how far it can be trusted at each pixel.
 * The base band (local mean) is where photographs must agree: blur keeps a local mean, glare
 * raises it and a shadow lowers it. Every view is gated against the median of all views, never
 * against the reference alone; strictly when brighter (glare: PhotoScan's soft minimum), loosely
 * when darker. The detail band comes from the sharpest agreeing views, weighted by local
 * Laplacian energy ("lucky imaging"), so each region takes its detail from the photograph that
 * was in focus there. The result stays within the values of the agreeing views, so a view
 * cannot paint a mark the others contradict. Rows stream through bands with a margin for the
 * filters, so memory does not grow with the number of rows.
 */
export async function fuseViews(
  width: number,
  height: number,
  count: number,
  sample: FusionSampler,
  write: FusionWriter,
  signal?: AbortSignal,
): Promise<void> {
  abort(signal);
  if (count === 1) {
    // One photograph is its own best estimate; no filtering may touch its pixels.
    const values = [new Float64Array(width)],
      weights = [new Float32Array(width)],
      admitted = new Uint8Array(width);
    for (let y = 0; y < height; y++) {
      if (y % band === 0) await yieldFrame(signal);
      sample(y, values, weights);
      for (let x = 0; x < width; x++) admitted[x] = weights[0]![x]! > 0 ? 1 : 0;
      write(y, values[0]!, admitted, values);
    }
    return;
  }
  const rows = band + 2 * margin,
    size = rows * width;
  const z = Array.from({ length: count }, () => new Float64Array(size)),
    w = Array.from({ length: count }, () => new Float32Array(size)),
    base = Array.from({ length: count }, () => new Float32Array(size)),
    valid = Array.from({ length: count }, () => new Float32Array(size)),
    energy = Array.from({ length: count }, () => new Float32Array(size));
  const temp = new Float32Array(size),
    sum = new Float64Array(width),
    fused = new Float64Array(width),
    admitted = new Uint8Array(width);
  const bases = new Float64Array(count),
    sorted = new Float64Array(count),
    samples = new Float64Array(count),
    confidence = new Float64Array(count),
    sharpness = new Float64Array(count),
    ids = new Uint8Array(count);
  // Buffer row j holds image row top - margin + j; rows outside the image repeat the edge.
  const fill = (top: number, from: number) => {
    for (let j = from; j < rows; j++) {
      const y = top - margin + j;
      if (y >= 0 && y < height)
        sample(
          y,
          z.map((a) => a.subarray(j * width, (j + 1) * width)),
          w.map((a) => a.subarray(j * width, (j + 1) * width)),
        );
    }
    for (let j = 0; j < rows; j++) {
      const y = top - margin + j;
      if (y >= 0 && y < height) continue;
      const source = (y < 0 ? 0 : height - 1) - (top - margin);
      for (let v = 0; v < count; v++) {
        z[v]!.copyWithin(j * width, source * width, (source + 1) * width);
        w[v]!.copyWithin(j * width, source * width, (source + 1) * width);
      }
    }
  };
  for (let top = 0; top < height; top += band) {
    if (top === 0) fill(0, margin);
    else {
      for (let v = 0; v < count; v++) {
        z[v]!.copyWithin(0, band * width, size);
        w[v]!.copyWithin(0, band * width, size);
      }
      fill(top, 2 * margin);
    }
    await yieldFrame(signal);
    for (let v = 0; v < count; v++) {
      const zv = z[v]!,
        wv = w[v]!,
        b = base[v]!,
        q = valid[v]!,
        e = energy[v]!;
      for (let k = 0; k < size; k++) {
        const ok = wv[k]! > 0;
        q[k] = ok ? 1 : 0;
        b[k] = ok ? zv[k]! : 0;
      }
      e.fill(0);
      for (let j = 1; j < rows - 1; j++)
        for (let x = 1, k = j * width + 1; x < width - 1; x++, k++)
          if (q[k] && q[k - 1] && q[k + 1] && q[k - width] && q[k + width]) {
            const l = 4 * zv[k]! - zv[k - 1]! - zv[k + 1]! - zv[k - width]! - zv[k + width]!;
            e[k] = l * l;
          }
      blur(b, temp, width, rows, baseRadius, sum);
      blur(q, temp, width, rows, baseRadius, sum);
      blur(e, temp, width, rows, energyRadius, sum);
    }
    for (let j = margin; j < margin + band && top + j - margin < height; j++) {
      for (let x = 0; x < width; x++) {
        const k = j * width + x;
        let n = 0;
        for (let v = 0; v < count; v++) {
          const c = w[v]![k]!,
            q = valid[v]![k]!,
            // Weight falls to zero towards the edge of a view's warped coverage: no seams.
            feather = Math.min(1, 2 * q - 1);
          if (!(c > 0) || feather <= 0) continue;
          bases[n] = base[v]![k]! / q;
          samples[n] = z[v]![k]!;
          confidence[n] = c * feather;
          sharpness[n] = (energy[v]![k]! + floor) ** power;
          ids[n++] = v;
        }
        admitted[x] = 0;
        if (n === 0) {
          fused[x] = z[0]![k]!;
          continue;
        }
        for (let i = 0; i < n; i++) {
          let p = i;
          while (p > 0 && sorted[p - 1]! > bases[i]!) {
            sorted[p] = sorted[p - 1]!;
            p--;
          }
          sorted[p] = bases[i]!;
        }
        const consensus = n % 2 ? sorted[n >> 1]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
        let total = 0,
          mean = 0,
          detailTotal = 0,
          detail = 0,
          low = Infinity,
          high = -Infinity,
          best = 0,
          bestGate = -1;
        for (let i = 0; i < n; i++) {
          const r = bases[i]! - consensus,
            gate = Math.exp(-((r / (r > 0 ? tauBright : tauDark)) ** 2));
          if (gate > bestGate) {
            best = i;
            bestGate = gate;
          }
          if (gate < cut) continue;
          const a = gate * confidence[i]!,
            s = gate * a * sharpness[i]!;
          total += a;
          mean += a * bases[i]!;
          detailTotal += s;
          detail += s * (samples[i]! - bases[i]!);
          if (gate >= trusted) {
            low = Math.min(low, samples[i]!);
            high = Math.max(high, samples[i]!);
            admitted[x] = admitted[x]! | (1 << ids[i]!);
          }
        }
        // With an even count the consensus is a mean that no view need sit on; when the two
        // middle views disagree, the one nearest it (the darker, under glare) stands alone.
        fused[x] =
          low <= high && detailTotal > 0
            ? Math.max(low, Math.min(high, mean / total + detail / detailTotal))
            : samples[best]!;
      }
      write(
        top + j - margin,
        fused,
        admitted,
        z.map((a) => a.subarray(j * width, (j + 1) * width)),
      );
    }
    await yieldFrame(signal);
  }
}
