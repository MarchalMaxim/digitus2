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

/** Output rows per streamed band; a multiple of the registration tile. */
const band = 64,
  /** Spacing of the registration check: one decision per tile, interpolated between tiles. */
  tile = 16,
  /** Largest offset, in output pixels, the registration check compares with zero. */
  reach = 2,
  baseRadius = 4,
  /** The fine band (a mark a few pixels wide, without the base's broad halo) and the Laplacian
   * energy are taken over this radius. */
  fineRadius = 3,
  energyRadius = 2,
  /** Rows above and below a band: the check's windows (a tile on each side of its tile), their
   * offsets and the fine filter. The base filter needs less. */
  margin = Math.max(tile + tile / 2 + reach + 2 * fineRadius, 2 * baseRadius),
  tauBright = 10,
  tauDark = 20,
  cut = 0.02,
  trusted = 0.5,
  /** The reference defines the page's coordinates: its fine band outweighs a view's in the
   * anchor the others are checked against. */
  referenceAnchor = 4,
  /** Offsets (dx, dy) of the registration check, zero first, then the two axes. */
  offsets = [0, 0, 0, -1, 0, 1, -1, 0, 1, 0, 0, -2, 0, 2, -2, 0, 2, 0],
  bins = 4096,
  binWidth = 0.25,
  /** Lowest Laplacian noise variance assumed (sensor noise of half a grey level). */
  noiseFloor = 5,
  /** Power of the detail weight's Laplacian energy: high enough that the photograph in focus
   * supplies a mark's detail, while plain paper (all views at the common floor) averages. */
  sharpness = 4;

const clamp01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t);
/** Share of a sample's detail its registration confidence allows: none at the camera's cut for
 * extrapolated samples (0.35) or from a clipped highlight, all from 0.45. Where the detail lands
 * is checked separately (admission). */
const detailShare = (c: number) => clamp01((c - 0.35) / 0.1);
/** Share of a sample's base: healthy samples count alike; a clipped highlight or a sample at the
 * edge of a view's registered coverage fades to (almost) nothing, continuously. */
const baseShare = (c: number) => Math.max(clamp01((c - 0.35) / 0.2), 1e-3 * c);

function abort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Processing aborted', 'AbortError');
}
async function yieldFrame(signal?: AbortSignal) {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  abort(signal);
}
/** Yield to the page at least every 25 ms of work, so Cancel answers while a page is combined. */
function pacer(signal?: AbortSignal) {
  let last = performance.now();
  return async () => {
    abort(signal);
    if (performance.now() - last < 25) return;
    await yieldFrame(signal);
    last = performance.now();
  };
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
 * How far a view's detail around one tile may be trusted, from the normalised cross-correlation
 * of its fine band with the anchor (the other photographs' fine band, mostly the reference's) at
 * zero and at offsets of one and two pixels, over a tent-weighted window two tiles wide.
 * A view misregistered by a pixel or more would draw every line twice beside the others, so its
 * detail counts only where zero offset matches (nearly) as well as any other and, where the
 * correlation peaks sharply (both sharp), the peak lies within about three quarters of a pixel.
 * A broad peak (one of them soft) or a direction without structure (along a staff line) is
 * judged by the loss at zero alone: there a small shift moves a soft edge, it doubles nothing.
 * A window where the view shows only noise passes (averaging noise is harmless); one where the
 * view shows a mark the anchor lacks fails (a hair or a scratch in one photograph).
 */
function admission(
  num: Float64Array,
  ev: number,
  ea: number,
  pixels: number,
  quiet: boolean,
  witnessed: number,
): number {
  if (pixels < 24) return 0;
  // Only noise to average, or no other photograph to compare with (all clipped there): this
  // view's base is the page's only evidence anyway, and with no other detail nothing can double.
  if (quiet || witnessed < 0.25 * pixels) return 1;
  if (!(ea > 0 && ev > 0)) return 0;
  const scale = Math.sqrt(ea * ev),
    c = (o: number) => num[o]! / scale,
    c0 = c(0);
  if (!(c0 > 0.15)) return 0;
  let best = c0;
  for (let o = 1; o < num.length; o++) best = Math.max(best, c(o));
  const axis = (minus: number, plus: number) => {
    const curvature = 2 * c0 - minus - plus;
    if (!(curvature > 0.3 * c0)) return 1;
    return clamp01((0.75 - Math.abs((minus - plus) / (2 * curvature))) / 0.5);
  };
  return (
    clamp01((c0 - 0.15) / 0.2) *
    clamp01((0.12 - (best - c0)) / 0.08) *
    axis(c(1), c(2)) *
    axis(c(3), c(4))
  );
}

/**
 * Multi-view fusion on the output grid (issue 143): the static form of a Kalman update, each
 * photograph a measurement of one page weighted by how far it can be trusted at each pixel.
 * The base band (local mean) is where photographs must agree: blur keeps a local mean, glare
 * raises it and a shadow lowers it. Every view is gated against the weighted median of all views
 * (clipped samples barely vote; interpolated, so it never switches at an edge), never against the
 * reference alone; strictly when brighter (glare: PhotoScan's soft minimum), loosely when darker.
 * Base weights fade continuously at the edges of a view's coverage, so a photograph whose paper
 * is a shade darker leaves no blocks.
 * The detail band must also agree in position. Each view's fine band is checked tile by tile
 * against the other photographs' (see admission); a view that fails there gives no detail, and
 * its base takes the reference's local shape at its own paper level. Admitted detail is weighted
 * by local Laplacian energy over the view's own noise ("lucky imaging" that does not mistake noise
 * for sharpness), so each region takes its detail from the photograph that was in focus there,
 * and plain paper averages the views by inverse noise variance. The reference's detail always
 * counts where it is not clipped; the other views' detail only in proportion to how much of the
 * local structure the verified views account for. The detail stays within the verified views'
 * own details, the value within the samples of the views that count, and a clear mark in the
 * reference keeps at least half its depth. Rows stream through bands with a margin for the
 * filters, so memory does not grow with the page; `bandRows` exists for tests, the output does
 * not depend on it.
 */
export async function fuseViews(
  width: number,
  height: number,
  count: number,
  sample: FusionSampler,
  write: FusionWriter,
  signal?: AbortSignal,
  bandRows = band,
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
  const step = Math.max(tile, Math.round(bandRows / tile) * tile),
    rows = step + 2 * margin,
    size = rows * width;
  const views = () => Array.from({ length: count }, () => new Float32Array(size));
  const z = Array.from({ length: count }, () => new Float64Array(size)),
    w = views(),
    base = views(),
    valid = views(),
    vote = views(),
    energy = views(),
    laplacian = views(),
    fine = views(),
    norm = views(),
    anchor = views(),
    witness = Array.from({ length: count }, () => new Uint8Array(size));
  const temp = new Float32Array(size),
    fineValid = new Float32Array(size),
    sum = new Float64Array(width),
    fused = new Float64Array(width),
    admitted = new Uint8Array(width),
    histogram = new Uint32Array(bins);
  const tileRows = Math.ceil(height / tile),
    tileCols = Math.ceil(width / tile);
  // Per view: registration admission per tile, Laplacian noise variance per tile row.
  const admit = Array.from({ length: count }, () => new Float32Array(tileRows * tileCols).fill(1)),
    // Per view and tile: its mean base minus the reference's (exposure and shading, not marks).
    offset = Array.from({ length: count }, () => new Float32Array(tileRows * tileCols).fill(NaN)),
    // Per view and tile: its paper level, the brightest of its local means around the tile.
    paper = Array.from({ length: count }, () => new Float32Array(tileRows * tileCols)),
    noise = Array.from({ length: count }, () => new Float32Array(tileRows).fill(noiseFloor)),
    measured = Array.from({ length: count }, () => new Float32Array(tileRows));
  let tilesDone = 0,
    noiseDone = 0;
  const bases = new Float64Array(count),
    votes = new Float64Array(count),
    order = new Uint8Array(count),
    samples = new Float64Array(count),
    shares = new Float64Array(count),
    passes = new Float64Array(count),
    noiseAt = new Float64Array(count),
    eligible = new Float64Array(count),
    gates = new Float64Array(count),
    levels = new Float64Array(count),
    feathers = new Float64Array(count),
    ids = new Uint8Array(count),
    trust = new Float64Array(count),
    num = new Float64Array(offsets.length / 2),
    shifts = Int32Array.from({ length: offsets.length / 2 }, (_, o) => offsets[2 * o]!),
    rises = Int32Array.from({ length: offsets.length / 2 }, (_, o) => offsets[2 * o + 1]!);
  // Interpolation between tile centres (tile rows or columns), clamped at the edges.
  const between = (p: number, n: number) => {
    const t = (p - (tile - 1) / 2) / tile,
      i = Math.max(0, Math.min(n - 1, Math.floor(t)));
    return { i, j: Math.min(n - 1, i + 1), f: clamp01(t - i) };
  };
  const columns = Array.from({ length: width }, (_, x) => between(x, tileCols));
  // Tent window of the check, two tiles wide, centred on a tile: weight by distance in pixels.
  const window = (d: number) => Math.max(0, 1 - Math.abs(d) / tile),
    windowWeights = Float64Array.from({ length: 2 * tile }, (_, i) => window(i - tile + 0.5));
  let origin = 0;
  // Buffer row j holds image row origin + j; rows outside the image repeat the edge.
  const pause = pacer(signal);
  const fill = async (from: number) => {
    for (let j = from; j < rows; j++) {
      if ((j & 7) === 0) await pause();
      const y = origin + j;
      if (y >= 0 && y < height)
        sample(
          y,
          z.map((a) => a.subarray(j * width, (j + 1) * width)),
          w.map((a) => a.subarray(j * width, (j + 1) * width)),
        );
    }
    for (let j = 0; j < rows; j++) {
      const y = origin + j;
      if (y >= 0 && y < height) continue;
      const source = (y < 0 ? 0 : height - 1) - origin;
      for (let v = 0; v < count; v++) {
        z[v]!.copyWithin(j * width, source * width, (source + 1) * width);
        w[v]!.copyWithin(j * width, source * width, (source + 1) * width);
      }
    }
  };
  for (let top = 0; top < height; top += step) {
    origin = top - margin;
    if (top === 0) await fill(0);
    else {
      for (let v = 0; v < count; v++) {
        z[v]!.copyWithin(0, step * width, size);
        w[v]!.copyWithin(0, step * width, size);
      }
      await fill(rows - step);
    }
    await yieldFrame(signal);
    for (let v = 0; v < count; v++) {
      await pause();
      const zv = z[v]!,
        wv = w[v]!,
        b = base[v]!,
        q = valid[v]!,
        u = vote[v]!,
        e = energy[v]!,
        l = laplacian[v]!,
        h = fine[v]!;
      let complete = true;
      for (let k = 0; k < size; k++) {
        const ok = wv[k]! > 0;
        if (!ok) complete = false;
        q[k] = fineValid[k] = ok ? 1 : 0;
        b[k] = h[k] = ok ? zv[k]! : 0;
        u[k] = ok ? wv[k]! : 0;
      }
      // Where a view covers the whole band (the reference always does) its blurred coverage is
      // exactly one: no need to filter it.
      blur(h, temp, width, rows, fineRadius, sum);
      if (!complete) blur(fineValid, temp, width, rows, fineRadius, sum);
      const f = norm[v]!;
      for (let k = 0; k < size; k++) {
        h[k] = q[k]! ? zv[k]! - h[k]! / fineValid[k]! : 0;
        f[k] = h[k]! * h[k]!;
      }
      blur(f, temp, width, rows, fineRadius, sum);
      e.fill(0);
      l.fill(NaN);
      for (let j = 1; j < rows - 1; j++)
        for (let x = 1, k = j * width + 1; x < width - 1; x++, k++)
          if (q[k] && q[k - 1] && q[k + 1] && q[k - width] && q[k + width]) {
            const d = 4 * zv[k]! - zv[k - 1]! - zv[k + 1]! - zv[k - width]! - zv[k + width]!;
            l[k] = d;
            e[k] = d * d;
          }
      blur(b, temp, width, rows, baseRadius, sum);
      if (!complete) blur(q, temp, width, rows, baseRadius, sum);
      blur(u, temp, width, rows, baseRadius, sum);
      blur(e, temp, width, rows, energyRadius, sum);
    }
    const lastTile = Math.min(tileRows - 1, Math.floor((top + step) / tile));
    // Sensor noise of each view per tile row (measured a quarter tile higher, so the row after
    // the band's last tile is known too) from the 20th percentile of the absolute Laplacian: a
    // staff puts ink beside more than half of its rows, so the median would measure the music.
    // (A clipped highlight reads as no noise; it covers too little of a row to move this.)
    // A tile row takes the median of
    // its own and the four previous estimates (noise changes slowly down a page; music does not).
    for (; noiseDone <= Math.min(tileRows - 1, lastTile + 1); noiseDone++)
      for (let v = 0, t = noiseDone; v < count; v++) {
        histogram.fill(0);
        let n = 0;
        const l = laplacian[v]!;
        for (
          let y = Math.max(0, t * tile - tile / 4);
          y < Math.min(height, (t + 1) * tile - tile / 4);
          y++
        )
          for (let k = (y - origin) * width, end = k + width; k < end; k++) {
            const a = Math.abs(l[k]!);
            if (a !== a) continue;
            const bin = Math.min(bins - 1, Math.floor(a / binWidth));
            histogram[bin] = histogram[bin]! + 1;
            n++;
          }
        let low = 0;
        for (let i = 0, seen = 0; i < bins && n > 0; i++)
          if ((seen += histogram[i]!) >= 0.2 * n) {
            low = (i + 0.5) * binWidth;
            break;
          }
        // A half-normal's 20th percentile lies at 0.2533 standard deviations.
        measured[v]![t] = n > 0 ? (low / 0.2533) ** 2 : NaN;
        const recent = Array.from(measured[v]!.subarray(Math.max(0, t - 4), t + 1)).filter(
          (m) => m === m,
        );
        recent.sort((p, q) => p - q);
        noise[v]![t] = Math.max(noiseFloor, recent[(recent.length - 1) >> 1] ?? noiseFloor);
      }
    // The anchor over the new tiles' windows. Additive glare and multiplicative shadow leave the
    // fine band's shape alone; only clipping and doubtful registration keep a view out of it.
    // The check compares shapes, not contrast: each fine band is divided by its local RMS
    // (floored at twice its noise), so a soft photograph's marks count as much as a sharp one's
    // and a window half sharp, half soft is not dominated by either half.
    const windowTop = Math.max(0, tilesDone * tile - tile / 2),
      windowEnd = Math.min(height, (lastTile + 1) * tile + tile / 2);
    for (let y = windowTop - reach; y < windowEnd + reach; y++) {
      const t = Math.max(0, Math.min(tileRows - 1, Math.floor(y / tile)));
      for (let v = 0; v < count; v++) {
        const h = fine[v]!,
          f = norm[v]!,
          floor = (4 * noise[v]![t]!) / 20;
        for (let k = (y - origin) * width, end = k + width; k < end; k++)
          f[k] = h[k]! / Math.sqrt(f[k]! + floor);
      }
    }
    // Each view's anchor: the others' normalised fine band, weighted by how far their detail
    // may be trusted (zero where none may: nothing to compare with).
    for (let y = windowTop - reach; y < windowEnd + reach; y++)
      for (let k = (y - origin) * width, end = k + width; k < end; k++) {
        let s = 0,
          total = 0;
        for (let v = 0; v < count; v++) {
          const a = detailShare(w[v]![k]!) * (v === 0 ? referenceAnchor : 1);
          trust[v] = a;
          s += a * norm[v]![k]!;
          total += a;
        }
        for (let v = 1; v < count; v++) {
          const rest = total - trust[v]!;
          witness[v]![k] = rest > 1e-9 ? 1 : 0;
          anchor[v]![k] = rest > 1e-9 ? (s - trust[v]! * norm[v]![k]!) / rest : 0;
        }
      }
    // Registration of each view's detail on the new tiles, against the leave-one-out anchor.
    // The reference defines the coordinates and is never checked.
    for (let t = tilesDone; t <= lastTile; t++) {
      await pause();
      const centreY = t * tile + (tile - 1) / 2,
        fromY = Math.max(0, t * tile - tile / 2),
        toY = Math.min(height, (t + 1) * tile + tile / 2);
      for (let v = 1; v < count; v++) {
        const h = norm[v]!,
          raw = fine[v]!,
          a = anchor[v]!,
          seen = witness[v]!;
        for (let tc = 0; tc < tileCols; tc++) {
          const centreX = tc * tile + (tile - 1) / 2,
            fromX = Math.max(0, tc * tile - tile / 2),
            toX = Math.min(width, (tc + 1) * tile + tile / 2);
          num.fill(0);
          let ev = 0,
            ea = 0,
            energyRaw = 0,
            witnessed = 0,
            difference = 0,
            shade = 0,
            pixels = 0;
          for (let y = fromY; y < toY; y++) {
            const wy = window(y - centreY);
            // The window weighs the view's own pixels, so its shifted copies all see the same
            // weights: a soft anchor under a sloping window would otherwise lean towards the
            // window's centre by up to a pixel.
            for (let x = fromX, k = (y - origin) * width + fromX; x < toX; x++, k++) {
              if (!(w[v]![k]! > 0)) continue;
              const weight = wy * windowWeights[x - centreX + tile - 0.5]!,
                wh = weight * h[k]!;
              ev += wh * h[k]!;
              ea += weight * a[k]! * a[k]!;
              energyRaw += weight * raw[k]! * raw[k]!;
              pixels += weight;
              witnessed += seen[k]! * weight;
              if (w[0]![k]! >= 0.5) {
                difference +=
                  weight * (base[v]![k]! / valid[v]![k]! - base[0]![k]! / valid[0]![k]!);
                shade += weight;
              }
              for (let o = 0; o < num.length; o++) {
                const sx = x - shifts[o]!;
                if (sx >= 0 && sx < width)
                  num[o] = num[o]! + wh * a[k - rises[o]! * width - shifts[o]!]!;
              }
            }
          }
          // A window where the view's fine band is at its noise level shows no mark to double.
          const quiet = !(energyRaw > (3 * noise[v]![t]! * pixels) / 20);
          admit[v]![t * tileCols + tc] = admission(num, ev, ea, pixels, quiet, witnessed);
          offset[v]![t * tileCols + tc] = shade > 0 ? difference / shade : NaN;
        }
      }
    }
    for (let t = tilesDone; t <= lastTile; t++)
      for (let v = 0; v < count; v++)
        for (let tc = 0; tc < tileCols; tc++) {
          let level = -Infinity;
          for (
            let y = Math.max(0, t * tile - tile / 2);
            y < Math.min(height, (t + 1) * tile + tile / 2);
            y++
          )
            for (
              let x = Math.max(0, tc * tile - tile / 2), k = (y - origin) * width + x;
              x < Math.min(width, (tc + 1) * tile + tile / 2);
              x++, k++
            )
              if (w[v]![k]! > 0) level = Math.max(level, base[v]![k]! / valid[v]![k]!);
          paper[v]![t * tileCols + tc] = level > -Infinity ? level : NaN;
        }
    tilesDone = lastTile + 1;
    for (let j = margin; j < margin + step && origin + j < height; j++) {
      if ((j & 7) === 0) await pause();
      const rowAt = between(origin + j, tileRows);
      for (let x = 0; x < width; x++) {
        const k = j * width + x,
          col = columns[x]!;
        let n = 0,
          all = 0;
        for (let v = 0; v < count; v++) {
          const c = w[v]![k]!,
            q = valid[v]![k]!,
            // Weight falls to zero towards the edge of a view's warped coverage: no seams.
            feather = Math.min(1, 2 * q - 1);
          if (!(c > 0) || feather <= 0) continue;
          let p = 1;
          if (v > 0) {
            const grid = admit[v]!,
              r0 = rowAt.i * tileCols,
              r1 = rowAt.j * tileCols;
            p =
              (grid[r0 + col.i]! * (1 - col.f) + grid[r0 + col.j]! * col.f) * (1 - rowAt.f) +
              (grid[r1 + col.i]! * (1 - col.f) + grid[r1 + col.j]! * col.f) * rowAt.f;
            // Between a passing and a failing tile the interpolation is no evidence of either:
            // only the passing side's last half counts, so a fold smaller than the tile spacing
            // does not leak in from the clean tiles beside it.
            p = clamp01(2 * p - 1);
          }
          bases[n] = base[v]![k]! / q;
          if (v > 0 && p < 1 && w[0]![k]! >= 0.5) {
            // Where its detail failed the check, a view's base may carry its misplaced marks as
            // a faint smear. It keeps its own paper level (the smooth offset from the reference)
            // but takes the reference's local shape, so nothing switches at the tile edges.
            const grid = offset[v]!,
              r0 = rowAt.i * tileCols,
              r1 = rowAt.j * tileCols,
              shift =
                (grid[r0 + col.i]! * (1 - col.f) + grid[r0 + col.j]! * col.f) * (1 - rowAt.f) +
                (grid[r1 + col.i]! * (1 - col.f) + grid[r1 + col.j]! * col.f) * rowAt.f;
            if (shift === shift)
              bases[n] = p * bases[n]! + (1 - p) * (base[0]![k]! / valid[0]![k]! + shift);
          }
          samples[n] = z[v]![k]!;
          // The base is the low band: a pixel or two of misregistration barely moves it, and the
          // consensus gate already rejects a base that disagrees. Tying it to the detail check would
          // switch the paper between photographs tile by tile.
          shares[n] = baseShare(vote[v]![k]! / q) * feather;
          feathers[n] = feather;
          {
            const grid = paper[v]!,
              r0 = rowAt.i * tileCols,
              r1 = rowAt.j * tileCols;
            levels[n] =
              (grid[r0 + col.i]! * (1 - col.f) + grid[r0 + col.j]! * col.f) * (1 - rowAt.f) +
              (grid[r1 + col.i]! * (1 - col.f) + grid[r1 + col.j]! * col.f) * rowAt.f;
          }
          // A highlight clipped here and there (bright paper at a high gain) must not switch the
          // view's detail on and off from pixel to pixel; only a patch clipped throughout (glare)
          // loses it. The best weight of the pixel and its four neighbours decides.
          const wv = w[v]!,
            near = Math.max(
              c,
              x > 0 ? wv[k - 1]! : 0,
              x < width - 1 ? wv[k + 1]! : 0,
              wv[k - width]!,
              wv[k + width]!,
            );
          eligible[n] = detailShare(near * feather);
          passes[n] = p;
          noiseAt[n] = noise[v]![rowAt.i]! * (1 - rowAt.f) + noise[v]![rowAt.j]! * rowAt.f;
          ids[n] = v;
          let i = n++;
          while (i > 0 && bases[order[i - 1]!]! > bases[n - 1]!) {
            order[i] = order[i - 1]!;
            i--;
          }
          order[i] = n - 1;
        }
        // Healthy samples vote alike. A clipped highlight (or a doubtful sample) loses its vote only
        // where its photograph's paper is brighter than another's: glare. On paper every photograph
        // shows at the same level (white paper may clip in all of them) it still votes.
        let darkest = Infinity;
        for (let i = 0; i < n; i++)
          if (levels[i] === levels[i]) darkest = Math.min(darkest, levels[i]!);
        all = 0;
        for (let i = 0; i < n; i++) {
          const glare = levels[i] === levels[i] ? clamp01((levels[i]! - darkest - 5) / 20) : 1;
          votes[i] = feathers[i]! * (1 - glare) + shares[i]! * glare;
          // The base blends by the same weights: a fading view only fades where its paper differs.
          shares[i] = votes[i]!;
          // So does the detail: a sample clipped on white paper still shows where the marks are.
          eligible[i] = feathers[i]! * (1 - glare) + eligible[i]! * glare;
          passes[i] = eligible[i]! * passes[i]!;
          all += votes[i]!;
        }
        // Against a single other photograph the reference holds out (a hand shadow there is as
        // likely as soft glare here, and the reference defines the page); two or more agreeing
        // views, or its own clipping, overrule it. The extra weight fades as others join.
        if (ids[0] === 0 && n > 1) {
          const extra = votes[0]! * 1 * clamp01(2 - (all - votes[0]!));
          votes[0] = votes[0]! + extra;
          all += extra;
        }
        admitted[x] = 0;
        if (n === 0) {
          fused[x] = z[0]![k]!;
          continue;
        }
        // Weighted median, interpolated between neighbouring views (each sits at the middle of
        // its share of the votes) over a narrow band around an even split: continuous as votes
        // and bases change, so the paper never switches between photographs at a hard edge, yet
        // a clear majority settles on its own view. An even split lands between two views, where
        // the strict gate for the brighter one (glare) leaves the darker.
        let consensus = bases[order[n - 1]!]!;
        for (let i = 0, seen = 0, previous = -Infinity; i < n; i++) {
          const middle = seen + votes[order[i]!]! / 2;
          if (middle >= all / 2) {
            const here = bases[order[i]!]!;
            consensus =
              i === 0
                ? here
                : bases[order[i - 1]!]! +
                  (here - bases[order[i - 1]!]!) *
                    clamp01(((all / 2 - previous) / (middle - previous) - 0.5) * 3 + 0.5);
            break;
          }
          seen += votes[order[i]!]!;
          previous = middle;
        }
        let quiet = 0;
        for (let i = 0; i < n; i++) quiet = Math.max(quiet, noiseAt[i]!);
        quiet *= 2;
        let total = 0,
          mean = 0,
          detailTotal = 0,
          sharp = 0,
          own = 0,
          offered = 0,
          verified = 0,
          low = Infinity,
          high = -Infinity,
          least = Infinity,
          most = -Infinity,
          mark = 0;
        // The consensus may fall between two views that disagree widely; the one nearest it then
        // stands alone rather than none at all.
        let nearest = 0;
        for (let i = 0; i < n; i++) {
          const r = bases[i]! - consensus;
          gates[i] = Math.exp(-((r / (r > 0 ? tauBright : tauDark)) ** 2));
          if (gates[i]! > gates[nearest]!) nearest = i;
        }
        const floor = Math.min(cut, gates[nearest]!);
        for (let i = 0; i < n; i++) {
          const g = gates[i]!,
            // The reference's detail stays wherever it is not clipped, even where its base lost
            // the vote (glare adds light but leaves the marks' shape; a shaded view may be the
            // darker one): it defines the page, and dropping it would erase the marks whenever
            // the other view's detail cannot be verified.
            // Another view's detail needs its base to agree, not merely to be nearest.
            d = ids[i] === 0 ? 1 : g < floor ? 0 : g * clamp01((g - 0.2) / 0.3);
          if (g >= floor) {
            // A view the gate barely lets in does not move the paper (the nearest always counts).
            const a = g * shares[i]! * (i === nearest ? 1 : clamp01((g - 0.1) / 0.2));
            total += a;
            mean += a * bases[i]!;
          }
          if (eligible[i]! > 0 && d > 0) {
            // Laplacian energy over the view's noise: a noisy photograph is not a sharp one, and
            // on plain paper the views average by inverse noise variance.
            const e = Math.max(1, energy[ids[i]!]![k]! / quiet),
              s = (d * d * passes[i]! * e ** sharpness) / noiseAt[i]!;
            detailTotal += s;
            if (ids[i] === 0) own += s * (samples[i]! - bases[i]!);
            else sharp += s * (samples[i]! - bases[i]!);
            offered += d * eligible[i]! * e;
            verified += d * passes[i]! * e;
          }
          if (g >= trusted) admitted[x] = admitted[x]! | (1 << ids[i]!);
          if (g >= floor || d > 0) {
            least = Math.min(least, samples[i]!);
            most = Math.max(most, samples[i]!);
          }
          // The detail stays within the details of the verified views that count here: no
          // overshoot beyond what one of them measured. (Clamping the value instead would snap
          // the paper to whichever photographs pass, tile by tile.)
          if (d > 0 && passes[i]! >= 0.5) {
            low = Math.min(low, samples[i]! - bases[i]!);
            high = Math.max(high, samples[i]! - bases[i]!);
          }
          if (ids[i] === 0 && eligible[i]! >= 0.5) mark = samples[i]! - bases[i]!;
        }
        // The detail comes from the verified views, but normalising their weights must not let
        // a barely verified view stand in for an unverified sharper one (a hair or a doubled
        // line seen by one photograph only): the other views' detail keeps only the share of the
        // local structure, by energy, that the verified views account for, in full from one
        // half. The reference's own detail is never scaled down: it defines the page.
        const level = mean / total;
        let detail =
          detailTotal > 0 ? (own + Math.min(1, (2 * verified) / offered) * sharp) / detailTotal : 0;
        if (low <= high) detail = Math.max(Math.min(low, 0), Math.min(Math.max(high, 0), detail));
        // And the value within the samples of every view that counts here.
        let value = Math.max(least, Math.min(most, level + detail));
        // A clear mark in the reference (not clipped there) keeps at least half its depth: no
        // view, however sharp or slightly misplaced, may erase a barline or a stem the page's
        // own photograph shows.
        if (mark < -30) value = Math.min(value, level + mark / 2);
        fused[x] = value;
      }
      write(
        origin + j,
        fused,
        admitted,
        z.map((a) => a.subarray(j * width, (j + 1) * width)),
      );
    }
    await yieldFrame(signal);
  }
}
