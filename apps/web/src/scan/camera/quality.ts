import type { Frame, Point } from './vision.js';

export interface FrameQuality {
  /** Mean luminance, 0..255. */
  brightness: number;
  /** 0 crisp .. 1 fully blurred: a no-reference blur estimate that does not depend on how much ink the page has. */
  blur: number;
  /** Share of the page area (or of the frame when no page is found) that is blown-out white glare. */
  glare: number;
  /** The page outline in frame pixels, clockwise from top-left, or null when no page stands out from its background (for example when the page fills the frame). */
  page: Point[] | null;
  /** The paper's level: the 90th-percentile luminance, 0..255. Optional so a quality built
   * from the four fields above still works; darkness then falls back to the mean. */
  paper?: number;
}
export type Advice = 'dark' | 'blurry' | 'noPage' | 'good';

// Calibrated on the owner's phone photos (research/omr/photos) at tracking size: sharp they
// read blur 0, blurred by 2 photo pixels 0.03 to 0.26, by 3 pixels 0.52 to 0.72. Their paper
// sits at 133 to 254; the dimmest (133, mean 110) is dim warm light and still reads well.
const DARK_PAPER = 80;
const DARK_MEAN = 65;
const BLURRY = 0.45;
// Re-blur box of 2R+1 taps: Crété-Roffet et al. use 9 on full-size images; at 360 px the
// staff lines are 2 to 4 px apart and a wide box would average them into grey.
const R = 1;
const GLARE = 250;

function luminance(frame: Frame): Uint8Array {
  const n = frame.width * frame.height,
    d = frame.data,
    out = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4)
    out[i] = (d[j]! * 77 + d[j + 1]! * 150 + d[j + 2]! * 29) >> 8;
  return out;
}

function level(counts: Uint32Array, total: number, share: number): number {
  for (let v = 0, seen = 0; v < 256; v++) if ((seen += counts[v]!) >= total * share) return v;
  return 255;
}
/** Median of absolute steps, interpolated inside its bin: integer steps would round sensor
 * noise of 1.5 levels down to a median of 1. */
function medianStep(counts: Uint32Array, total: number): number {
  for (let v = 0, seen = 0; v < 256; v++) {
    const c = counts[v]!;
    if (seen + c >= total / 2) return (v ? v - 0.5 : 0) + ((total / 2 - seen) / c) * (v ? 1 : 0.5);
    seen += c;
  }
  return 255;
}

/** After Crété-Roffet, Dolmiere, Ladret, Nicolas, "The blur effect: perception and
 * estimation with a new no-reference perceptual blur metric", SPIE 6492 (2007): re-blurring
 * a sharp edge removes most of its neighbour difference, a blurred one keeps it, and the
 * ratio of sums cancels how many edges there are. Squared differences and an edge floor
 * (six times the median step, which is sensor noise on paper, and a fifth of the ink
 * contrast) keep grain and the faint ripple that blur leaves on staff lines from passing as
 * sharp detail. */
function blurEffect(g: Uint8Array, w: number, x0: number, y0: number, x1: number, y1: number) {
  const k = 2 * R + 1,
    hist = new Uint32Array(256),
    steps = new Uint32Array(256);
  let n = 0;
  for (let y = y0; y < y1; y += 2)
    for (let x = x0, i = y * w + x0; x < x1; x += 2, i += 2) {
      hist[g[i]!]!++;
      steps[Math.abs(g[i]! - g[i - 1]!)]!++;
      n++;
    }
  const floor = Math.max(
    4,
    6 * medianStep(steps, n),
    0.2 * (level(hist, n, 0.9) - level(hist, n, 0.001)),
  );
  let fh = 0,
    vh = 0,
    ch = 0,
    fv = 0,
    vv = 0,
    cv = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0, i = y * w + x0; x < x1; x++, i++) {
      const c = g[i]!,
        dh = Math.abs(c - g[i - 1]!),
        dv = Math.abs(c - g[i - w]!);
      // A box re-blur's neighbour difference is the difference of the pixels k apart, over k.
      if (dh >= floor) {
        const v = Math.max(0, dh - Math.abs(g[i + R]! - g[i - R - 1]!) / k);
        fh += dh * dh;
        vh += v * v;
        ch++;
      }
      if (dv >= floor) {
        const v = Math.max(0, dv - Math.abs(g[i + R * w]! - g[i - (R + 1) * w]!) / k);
        fv += dv * dv;
        vv += v * v;
        cv++;
      }
    }
  // A direction with (almost) no edges is blurred away, and the few noise steps that clear
  // any floor must not decide; motion blurs one direction only.
  const least = (x1 - x0) * (y1 - y0) * 0.002;
  if (ch < least) fh = 0;
  if (cv < least) fv = 0;
  if (!fh && !fv) return 1;
  const b = Math.max(fh ? (fh - vh) / fh : 1, fv ? (fv - vv) / fv : 1),
    step = 1 - (1 - 1 / k) ** 2;
  // A perfect step reads `step`; rescale so it reads 0.
  return Math.min(1, Math.max(0, (b - step) / (1 - step)));
}

/** Row span [left, right) of a convex quad at pixel row y. */
function span(quad: readonly Point[], y: number): [number, number] {
  let left = Infinity,
    right = -Infinity;
  for (let i = 0; i < quad.length; i++) {
    const a = quad[i]!,
      b = quad[(i + 1) % quad.length]!;
    if ((y < a.y && y < b.y) || (y > a.y && y > b.y)) continue;
    const x = a.y === b.y ? Math.min(a.x, b.x) : a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y);
    const x2 = a.y === b.y ? Math.max(a.x, b.x) : x;
    left = Math.min(left, x);
    right = Math.max(right, x2);
  }
  return [left, right];
}

function glareShare(g: Uint8Array, w: number, h: number, page: readonly Point[] | null): number {
  let area = 0,
    blown = 0;
  for (let y = 1; y < h - 1; y++) {
    let a = 1,
      b = w - 1;
    if (page) {
      const [left, right] = span(page, y + 0.5);
      a = Math.max(1, Math.ceil(left));
      b = Math.min(w - 1, Math.floor(right));
    }
    if (b <= a) continue;
    area += b - a;
    for (let x = a, i = y * w + a; x < b; x++, i++) {
      if (g[i]! < GLARE) continue;
      // Clipped and textureless: the pixel and all its neighbours are blown out.
      if (
        g[i - 1]! >= GLARE &&
        g[i + 1]! >= GLARE &&
        g[i - w]! >= GLARE &&
        g[i + w]! >= GLARE &&
        g[i - w - 1]! >= GLARE &&
        g[i - w + 1]! >= GLARE &&
        g[i + w - 1]! >= GLARE &&
        g[i + w + 1]! >= GLARE
      )
        blown++;
    }
  }
  return area ? blown / area : 0;
}

/** 3x3 dilation (max) or erosion, separable. */
function morph(src: Uint8Array, w: number, h: number, max: boolean): Uint8Array {
  const tmp = new Uint8Array(src.length),
    out = new Uint8Array(src.length),
    pick = (a: number, b: number, c: number) =>
      max ? (a > b ? (a > c ? a : c) : b > c ? b : c) : a < b ? (a < c ? a : c) : b < c ? b : c;
  for (let y = 0, i = 0; y < h; y++)
    for (let x = 0; x < w; x++, i++)
      tmp[i] = pick(src[i]!, src[x > 0 ? i - 1 : i]!, src[x < w - 1 ? i + 1 : i]!);
  for (let y = 0, i = 0; y < h; y++)
    for (let x = 0; x < w; x++, i++)
      out[i] = pick(tmp[i]!, tmp[y > 0 ? i - w : i]!, tmp[y < h - 1 ? i + w : i]!);
  return out;
}

function otsu(values: Uint8Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < values.length; i++) hist[values[i]!]!++;
  let total = 0;
  for (let v = 0; v < 256; v++) total += v * hist[v]!;
  let below = 0,
    belowSum = 0,
    best = -1,
    threshold = 128;
  for (let t = 0; t < 255; t++) {
    below += hist[t]!;
    belowSum += t * hist[t]!;
    const above = values.length - below;
    if (!below || !above) continue;
    const between = below * above * (belowSum / below - (total - belowSum) / above) ** 2;
    if (between > best) {
      best = between;
      threshold = t + 1;
    }
  }
  return threshold;
}

const cross = (o: Point, a: Point, b: Point) =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
function area(polygon: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!,
      b = polygon[(i + 1) % polygon.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}
/** Andrew's monotone chain; clockwise on screen (y down). */
function hull(points: Point[]): Point[] {
  points.sort((a, b) => a.x - b.x || a.y - b.y);
  const lower: Point[] = [],
    upper: Point[] = [];
  for (const p of points) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i]!;
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** The paper: the largest bright region, with its holes (the notation) filled. */
function findPage(g: Uint8Array, w: number, h: number): Point[] | null {
  const s = Math.max(1, Math.round(Math.max(w, h) / 180)),
    cw = Math.floor(w / s),
    ch = Math.floor(h / s),
    n = cw * ch;
  if (cw < 16 || ch < 16) return null;
  const cells = new Uint8Array(n);
  for (let cy = 0; cy < ch; cy++)
    for (let cx = 0; cx < cw; cx++) {
      let sum = 0;
      for (let dy = 0; dy < s; dy++)
        for (let dx = 0, i = (cy * s + dy) * w + cx * s; dx < s; dx++) sum += g[i + dx]!;
      cells[cy * cw + cx] = sum / (s * s);
    }
  // Closing erases staff lines and stems, which would otherwise cut the paper apart.
  const closed = morph(morph(cells, cw, ch, true), cw, ch, false),
    t = otsu(closed),
    label = new Uint8Array(n),
    stack = new Int32Array(n);
  let best = -1,
    bestSize = 0;
  /** Four-connected flood from `seed` over unlabelled cells (bright ones only, if asked). */
  const fill = (seed: number, mark: number, bright: boolean) => {
    let top = 0,
      size = 0;
    stack[top++] = seed;
    label[seed] = mark;
    while (top) {
      const i = stack[--top]!,
        x = i % cw;
      size++;
      for (let k = 0; k < 4; k++) {
        const j =
          k === 0
            ? x > 0
              ? i - 1
              : -1
            : k === 1
              ? x < cw - 1
                ? i + 1
                : -1
              : k === 2
                ? i - cw
                : i + cw;
        if (j >= 0 && j < n && !label[j] && (!bright || closed[j]! >= t)) {
          label[j] = mark;
          stack[top++] = j;
        }
      }
    }
    return size;
  };
  for (let i = 0; i < n; i++)
    if (!label[i] && closed[i]! >= t) {
      const size = fill(i, 1, true);
      if (size > bestSize) {
        bestSize = size;
        best = i;
      }
    }
  if (best < 0 || bestSize * s * s < w * h * 0.15) return null;
  // Relabel: 2 marks the page, 3 the background reachable from the border; what stays 0 is
  // enclosed by the page (its notation) and belongs to it.
  label.fill(0);
  fill(best, 2, true);
  const touches = (from: number, step: number, count: number) => {
    for (let k = 0, i = from; k < count; k++, i += step) if (label[i] === 2) return 1;
    return 0;
  };
  if (
    touches(0, 1, cw) +
      touches((ch - 1) * cw, 1, cw) +
      touches(0, cw, ch) +
      touches(cw - 1, cw, ch) >=
    3
  )
    return null;
  for (let x = 0; x < cw; x++) {
    if (!label[x]) fill(x, 3, false);
    if (!label[(ch - 1) * cw + x]) fill((ch - 1) * cw + x, 3, false);
  }
  for (let y = 0; y < ch; y++) {
    if (!label[y * cw]) fill(y * cw, 3, false);
    if (!label[y * cw + cw - 1]) fill(y * cw + cw - 1, 3, false);
  }
  let pageCells = 0,
    pageSum = 0,
    backCells = 0,
    backSum = 0;
  const points: Point[] = [];
  for (let cy = 0; cy < ch; cy++) {
    let left = -1,
      right = -1;
    for (let cx = 0; cx < cw; cx++) {
      const i = cy * cw + cx;
      if (label[i] === 3) {
        backCells++;
        backSum += cells[i]!;
      } else {
        pageCells++;
        pageSum += cells[i]!;
        if (left < 0) left = cx;
        right = cx;
      }
    }
    if (left >= 0)
      points.push(
        { x: left * s, y: cy * s },
        { x: left * s, y: (cy + 1) * s },
        { x: (right + 1) * s, y: cy * s },
        { x: (right + 1) * s, y: (cy + 1) * s },
      );
  }
  if (backCells < n * 0.03 || pageSum / pageCells - backSum / backCells < 24) return null;
  const outline = hull(points),
    hullArea = area(outline);
  // Visvalingam: drop the vertices that carry the least area until the corners remain.
  while (outline.length > 12) {
    let least = Infinity,
      at = 0;
    for (let i = 0; i < outline.length; i++) {
      const a = Math.abs(
        cross(
          outline[(i + outline.length - 1) % outline.length]!,
          outline[i]!,
          outline[(i + 1) % outline.length]!,
        ),
      );
      if (a < least) {
        least = a;
        at = i;
      }
    }
    outline.splice(at, 1);
  }
  if (outline.length < 4) return null;
  let quad: Point[] = [],
    quadArea = 0;
  const m = outline.length;
  for (let a = 0; a < m; a++)
    for (let b = a + 1; b < m; b++)
      for (let c = b + 1; c < m; c++)
        for (let d = c + 1; d < m; d++) {
          const q = [outline[a]!, outline[b]!, outline[c]!, outline[d]!],
            qa = area(q);
          if (qa > quadArea) {
            quadArea = qa;
            quad = q;
          }
        }
  if (quadArea < w * h * 0.2 || quadArea < hullArea * 0.9 || pageCells * s * s < hullArea * 0.85)
    return null;
  const clamped = quad.map((p) => ({
    x: Math.min(w - 1, Math.max(0, p.x)),
    y: Math.min(h - 1, Math.max(0, p.y)),
  }));
  const first = clamped.reduce(
    (best, p, i) => (p.x + p.y < clamped[best]!.x + clamped[best]!.y ? i : best),
    0,
  );
  const ordered = [0, 1, 2, 3].map((k) => clamped[(first + k) % 4]!);
  for (let i = 0; i < 4; i++)
    if (cross(ordered[i]!, ordered[(i + 1) % 4]!, ordered[(i + 2) % 4]!) <= 1) return null;
  return ordered;
}

/** Call on tracking frames (long edge <= 360): the blur scale is calibrated at that size.
 * When the page runs off one or two borders, those sides of the outline follow the frame. */
export function measureFrame(frame: Frame): FrameQuality {
  const w = frame.width,
    h = frame.height;
  if (
    !Number.isInteger(w) ||
    !Number.isInteger(h) ||
    w < 24 ||
    h < 24 ||
    frame.data.length !== w * h * 4
  )
    return { brightness: 0, blur: 1, glare: 0, page: null, paper: 0 };
  const g = luminance(frame),
    hist = new Uint32Array(256);
  let sum = 0;
  for (let i = 0; i < g.length; i++) {
    sum += g[i]!;
    hist[g[i]!]!++;
  }
  const paper = level(hist, g.length, 0.9),
    page = findPage(g, w, h),
    margin = R + 2;
  let x0 = margin,
    y0 = margin,
    x1 = w - margin,
    y1 = h - margin;
  if (page) {
    // The rectangle inside the outline, so the table's grain does not count.
    x0 = Math.max(x0, Math.ceil(Math.max(page[0]!.x, page[3]!.x)) + 3);
    x1 = Math.min(x1, Math.floor(Math.min(page[1]!.x, page[2]!.x)) - 3);
    y0 = Math.max(y0, Math.ceil(Math.max(page[0]!.y, page[1]!.y)) + 3);
    y1 = Math.min(y1, Math.floor(Math.min(page[2]!.y, page[3]!.y)) - 3);
  }
  return {
    brightness: sum / g.length,
    blur: x1 - x0 > 8 && y1 - y0 > 8 ? blurEffect(g, w, x0, y0, x1, y1) : 1,
    glare: glareShare(g, w, h, page),
    page,
    paper,
  };
}

const dark = (q: FrameQuality, sticky: boolean) =>
  q.paper === undefined
    ? q.brightness < DARK_MEAN + (sticky ? 8 : 0)
    : q.paper < DARK_PAPER + (sticky ? 10 : 0);
const blurry = (q: FrameQuality, sticky: boolean) => q.blur > BLURRY - (sticky ? 0.07 : 0);
const severity: Advice[] = ['dark', 'blurry', 'noPage', 'good'];
function reading(q: FrameQuality, state?: Advice): Advice {
  if (dark(q, state === 'dark')) return 'dark';
  if (blurry(q, state === 'blurry')) return 'blurry';
  return q.page ? 'good' : 'noPage';
}

/** Stable advice from the most recent measurements (newest last): it changes only when consistent across at least two of the last few frames, so the message does not flicker.
 * Pass the last five or more measurements; only the last five count (four still ignore a
 * single odd frame). The advice is the reading of the latest two consecutive frames that
 * agree, each read with hysteresis around the advice so far; with no such pair, the most
 * severe reading in the window. The hysteresis lasts only as long as the window. */
export function advise(recent: readonly FrameQuality[]): Advice {
  const last = recent.slice(-5);
  if (!last.length) return 'good';
  let state = last
    .map((q) => reading(q))
    .reduce((a, b) => (severity.indexOf(b) < severity.indexOf(a) ? b : a));
  for (let i = 1; i < last.length; i++) {
    const a = reading(last[i - 1]!, state),
      b = reading(last[i]!, state);
    if (a === b) state = b;
  }
  return state;
}

/** True when this frame is good enough to photograph now. */
export function photographable(quality: FrameQuality): boolean {
  return !dark(quality, false) && !blurry(quality, false);
}
