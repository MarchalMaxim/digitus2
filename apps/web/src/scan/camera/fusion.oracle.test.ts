import { describe, expect, it } from 'vitest';
import { reconstructPage } from './reconstruction';
import { mapLocalPoint } from './localRegistration';
import type { Capture, Frame } from './vision';

/**
 * Ground truth for multi-view fusion (issue 143). Five photographs of one known page, each
 * degraded where a handheld phone degrades a picture: defocus in part of the frame, a glare spot
 * that moves with the phone, a hand shadow, exposure and sensor noise. The fused page is scored
 * against the page itself, and against each photograph alone resampled with the renderer's own
 * known geometry (never the production registration). Fusion earns its five photos only if it
 * beats the best of them.
 */

const W = 420,
  H = 540;
/** Staff tops; each staff has five one-pixel lines six pixels apart. */
const STAVES: number[] = [];
for (let top = 40; top < H - 50; top += 78) STAVES.push(top);
/** A bump of the page under one photograph that a phone's smooth registration cannot follow:
 * 3 pixels down at its centre, over the lines of the third staff where the reference is soft. */
const BUMP = { view: 3, x: 120, y: 205, radius: 10, depth: 3 };

function lcg(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

/** Engraved-looking notation: thin staff lines, filled heads, stems, beams, small numerals. */
function truthPage(): Float32Array {
  const g = new Float32Array(W * H).fill(245);
  const random = lcg(7);
  const ink = (x: number, y: number, v: number) => {
    if (x >= 0 && y >= 0 && x < W && y < H) g[y * W + x] = Math.min(g[y * W + x]!, v);
  };
  for (const top of STAVES) {
    for (let line = 0; line < 5; line++)
      for (let x = 18; x < W - 18; x++) ink(x, top + line * 6, 70);
    for (const bx of [18, 120, 222, 324, W - 19])
      for (let y = top; y <= top + 24; y++) ink(bx, y, 30);
    for (let n = 0; n < 22; n++) {
      const x = 26 + n * 17 + Math.floor(random() * 5),
        y = top - 4 + Math.floor(random() * 14) * 2.5;
      const head = Math.round(y);
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -3; dx <= 3; dx++)
          if ((dx * dx) / 10 + (dy * dy) / 5 <= 1) ink(x + dx, head + dy, 18);
      const stem = 13 + Math.floor(random() * 6);
      for (let dy = -stem; dy <= 0; dy++) ink(x + 3, head + dy, 25);
      if (n % 2 === 0)
        for (let dx = 0; dx <= 17; dx++)
          for (let t = 0; t < 2; t++) ink(x + 3 + dx, head - stem + t, 25);
      if (random() > 0.6)
        // A fingering numeral above the staff: three short strokes, the finest marks on a page.
        for (let k = 0; k < 3; k++)
          for (let dx = 0; dx < 3; dx++) ink(x - 1 + dx, top - 14 + k * 2, 35);
    }
  }
  return g;
}

/** Independent camera model: smooth page curvature plus motion between photographs, and with
 * `bumped` the local bump of BUMP in its view. */
function cameraPoint(x: number, y: number, view: number, bumped = false) {
  if (view === 0) return { x, y };
  const sign = view % 2 ? 1 : -1,
    bump =
      bumped && view === BUMP.view
        ? BUMP.depth * Math.exp(-((x - BUMP.x) ** 2 + (y - BUMP.y) ** 2) / (2 * BUMP.radius ** 2))
        : 0;
  return {
    x: x + sign * 4 * Math.sin(y / 105) + view * 2,
    y: y + sign * 5 * Math.sin(x / 125) * Math.sin(y / 170) - view * 2 + bump,
  };
}

function bilinear(g: Float32Array, x: number, y: number, outside = 245) {
  if (x < 0 || y < 0 || x > W - 1 || y > H - 1) return outside;
  const ix = Math.min(W - 2, Math.floor(x)),
    iy = Math.min(H - 2, Math.floor(y)),
    dx = x - ix,
    dy = y - iy;
  return (
    (g[iy * W + ix]! * (1 - dx) + g[iy * W + ix + 1]! * dx) * (1 - dy) +
    (g[(iy + 1) * W + ix]! * (1 - dx) + g[(iy + 1) * W + ix + 1]! * dx) * dy
  );
}

function gaussian(g: Float32Array, sigma: number): Float32Array {
  const r = Math.ceil(sigma * 3),
    k = Array.from({ length: 2 * r + 1 }, (_, i) =>
      Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)),
    );
  const total = k.reduce((a, b) => a + b, 0);
  const pass = (src: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(src.length);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let sum = 0;
        for (let i = -r; i <= r; i++) {
          const sx = horizontal ? Math.max(0, Math.min(W - 1, x + i)) : x,
            sy = horizontal ? y : Math.max(0, Math.min(H - 1, y + i));
          sum += src[sy * W + sx]! * k[i + r]!;
        }
        out[y * W + x] = sum / total;
      }
    return out;
  };
  return pass(pass(g, true), false);
}

const ramp = (value: number, from: number, to: number) =>
  Math.max(0, Math.min(1, (value - from) / (to - from)));

interface Degradation {
  /** 0..1, where the photograph is out of focus. */
  blur(x: number, y: number): number;
  glare: { x: number; y: number };
  /** 0..1, where a hand shadows the page. */
  shadow?(x: number, y: number): number;
  gain: number;
  bias: number;
}

const VIEWS: Degradation[] = [
  // The reference: soft on its left half, glare on the upper right.
  { blur: (x) => 1 - ramp(x, 205, 245), glare: { x: 320, y: 140 }, gain: 1, bias: 0 },
  { blur: (x) => ramp(x, 195, 235), glare: { x: 120, y: 410 }, gain: 0.94, bias: 8 },
  { blur: (_, y) => 1 - ramp(y, 250, 290), glare: { x: 330, y: 440 }, gain: 1.05, bias: -6 },
  {
    blur: () => 0,
    glare: { x: 150, y: 150 },
    shadow: (x, y) => (1 - ramp(x, 200, 240)) * ramp(y, 300, 340),
    gain: 0.97,
    bias: 4,
  },
  { blur: (_, y) => ramp(y, 290, 330), glare: { x: 250, y: 300 }, gain: 1.02, bias: -3 },
];

function photograph(
  truth: Float32Array,
  view: number,
  bumped = false,
): { frame: Frame; linear: Float32Array } {
  const d = VIEWS[view]!;
  // Geometry: the sensor pixel (x, y) sees the page point s with cameraPoint(s) = (x, y).
  const sharp = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let sx = x,
        sy = y;
      for (let i = 0; i < 8; i++) {
        const q = cameraPoint(sx, sy, view, bumped);
        sx += x - q.x;
        sy += y - q.y;
      }
      sharp[y * W + x] = bilinear(truth, sx, sy);
    }
  const soft = gaussian(sharp, 2.1);
  const noise = lcg(1000 + view);
  const linear = new Float32Array(W * H);
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x,
        b = d.blur(x, y);
      let v = sharp[i]! * (1 - b) + soft[i]! * b;
      v *= 1 - 0.38 * (d.shadow?.(x, y) ?? 0);
      v += 230 * Math.exp(-((x - d.glare.x) ** 2 + (y - d.glare.y) ** 2) / (2 * 16 * 16));
      v = v * d.gain + d.bias;
      linear[i] = v;
      v += (noise() + noise() + noise() - 1.5) * 6;
      const q = Math.max(0, Math.min(255, Math.round(v)));
      data.set([q, q, q, 255], i * 4);
    }
  return { frame: { width: W, height: H, data }, linear };
}

interface Score {
  /** Mean absolute error against the page, in grey levels, inside the page margin. */
  error: number;
  /** Error inside the reference's glare spot. */
  glare: number;
  /** Share of the page's ink pixels that read as ink (reported, not asserted: resampling
   * a one-pixel staff line at a half-pixel offset lands it on the threshold). */
  ink: number;
  /** Mean absolute error on the page's ink pixels: how faithfully the marks themselves read. */
  inkError: number;
  /** Paper pixels, well away from any ink, that read as ink: invented marks. Blind within
   * three pixels of ink, where a doubled or moved line lands: see lines. */
  ghosts: number;
  /** Staff-line columns (away from any other mark), over the page and inside BUMP. */
  lines: LineScore;
  bump: LineScore;
}
interface LineScore {
  columns: number;
  /** Columns where the line reads as two separate dips within two rows of its true row. */
  doubled: number;
  /** Columns whose only dip lies two rows off the true row. */
  moved: number;
}

/** Each staff line, column by column, between its neighbours (six rows apart): the dips (local
 * minima at least 20 levels below the column's lightest pixel within three rows) within two
 * rows of the true row. A line drawn twice a pixel or more apart shows two dips. */
function lineScore(
  truth: Float32Array,
  value: (x: number, y: number) => number,
  inside: (x: number, y: number) => boolean,
): LineScore {
  const score = { columns: 0, doubled: 0, moved: 0 };
  for (const top of STAVES)
    for (let line = 0; line < 5; line++) {
      const c = top + line * 6;
      for (let x = 24; x < W - 24; x++) {
        if (!inside(x, c)) continue;
        let alone = truth[c * W + x] === 70;
        for (let y = c - 3; y <= c + 3; y++) if (y !== c && truth[y * W + x]! < 200) alone = false;
        if (!alone) continue;
        const v = Array.from({ length: 7 }, (_, k) => value(x, c - 3 + k)),
          lightest = Math.max(...v);
        const dips: number[] = [];
        for (let k = 1; k <= 5; k++)
          if (v[k]! < v[k - 1]! && v[k]! <= v[k + 1]! && lightest - v[k]! >= 20) dips.push(k - 3);
        score.columns++;
        if (dips.length > 1) score.doubled++;
        else if (dips.length === 1 && Math.abs(dips[0]!) === 2) score.moved++;
      }
    }
  return score;
}

function scoreAgainst(truth: Float32Array, value: (x: number, y: number) => number): Score {
  const near = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (truth[y * W + x]! < 200)
        for (let dy = -3; dy <= 3; dy++)
          for (let dx = -3; dx <= 3; dx++) {
            const nx = x + dx,
              ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < W && ny < H) near[ny * W + nx] = 1;
          }
  let error = 0,
    count = 0,
    glare = 0,
    glareCount = 0,
    ink = 0,
    inkCount = 0,
    inkError = 0,
    ghosts = 0;
  for (let y = 24; y < H - 24; y++)
    for (let x = 24; x < W - 24; x++) {
      const t = truth[y * W + x]!,
        v = value(x, y),
        e = Math.abs(v - t);
      error += e;
      count++;
      if (Math.hypot(x - VIEWS[0]!.glare.x, y - VIEWS[0]!.glare.y) < 22) {
        glare += e;
        glareCount++;
      }
      if (t < 100) {
        inkCount++;
        inkError += e;
        if (v < 150) ink++;
      }
      if (!near[y * W + x] && v < 150) ghosts++;
    }
  return {
    error: error / count,
    glare: glare / glareCount,
    ink: ink / inkCount,
    inkError: inkError / inkCount,
    ghosts,
    lines: lineScore(truth, value, () => true),
    bump: lineScore(truth, value, (x, y) => Math.hypot(x - BUMP.x, y - BUMP.y) < BUMP.radius * 1.5),
  };
}

/** Five photographs of the page, each scored alone with the renderer's own geometry, and the
 * reconstruction from them with the production registration. */
async function scenario(bumped: boolean) {
  const truth = truthPage();
  const photos = VIEWS.map((_, view) => photograph(truth, view, bumped));
  // Each photograph alone, resampled with the renderer's known geometry and exposure.
  const single = photos.map(({ frame }, view) => {
    const d = VIEWS[view]!;
    const g = new Float32Array(W * H);
    for (let i = 0; i < g.length; i++) g[i] = frame.data[i * 4]!;
    return scoreAgainst(truth, (x, y) => {
      const p = cameraPoint(x, y, view, bumped);
      return (bilinear(g, p.x, p.y) - d.bias) / d.gain;
    });
  });
  const captures: Capture[] = photos.map(({ frame }, view) => ({
    frame,
    // A tracking estimate: right direction, a pixel or so off. Local alignment refines it.
    matrix:
      view === 0
        ? [1, 0, 0, 0, 1, 0, 0, 0, 1]
        : [1, 0, view * 2 + 1.2, 0, 1, -view * 2 - 0.8, 0, 0, 1],
  }));
  const corners = [
    { x: 0, y: 0 },
    { x: W - 1, y: 0 },
    { x: W - 1, y: H - 1 },
    { x: 0, y: H - 1 },
  ];
  const result = await reconstructPage(captures, corners);
  expect(result.frame.width).toBe(W);
  expect(result.frame.height).toBe(H);
  const fused = scoreAgainst(truth, (x, y) => result.frame.data[(y * W + x) * 4]!);
  const best = {
    error: Math.min(...single.map((s) => s.error)),
    inkError: Math.min(...single.map((s) => s.inkError)),
    glare: Math.min(...single.map((s) => s.glare)),
    ghosts: Math.min(...single.map((s) => s.ghosts)),
    doubled: Math.min(...single.map((s) => s.lines.doubled)),
    moved: Math.min(...single.map((s) => s.lines.moved)),
  };
  // Printed so a failing run shows how far off it is.
  console.info(
    'fusion oracle',
    bumped ? 'bumped' : 'plain',
    JSON.stringify({ fused, single, best }),
  );
  return { fused, single, best, result };
}

describe('multi-view fusion against a known page (issue 143)', () => {
  it('beats the best single photograph: sharper, glare-free, no invented marks', async () => {
    const { fused, best } = await scenario(false);
    expect(fused.error).toBeLessThan(best.error * 0.8);
    // Inside the reference's glare spot, cleaner than any photograph alone. Not an absolute
    // level: there only two views are both sharp and glare-free, and even a perfect average of
    // them keeps the soft ink edges their optics baked in (about 12.5 to 14.5 with ideal sampling).
    expect(fused.glare).toBeLessThan(best.glare);
    // Sharper marks than any one photograph: the sharp parts of each view supply the detail.
    expect(fused.inkError).toBeLessThan(best.inkError);
    // A few stray pixels at most; never a duplicated or invented mark.
    expect(fused.ghosts).toBeLessThanOrEqual(best.ghosts + 25);
    // No staff line drawn twice or moved, beyond what the best photograph alone shows.
    expect(fused.lines.doubled).toBeLessThanOrEqual(best.doubled + 3);
    expect(fused.lines.moved).toBeLessThanOrEqual(best.moved + 3);
  });

  it('draws each line once where one photograph is misregistered by a local bump', async () => {
    const { fused, single, best, result } = await scenario(true);
    // The bump must defeat the registration, or this case tests nothing: near its centre the
    // production map of that view stays at least 1.5 pixels from the true one.
    const alignment = result.alignments[BUMP.view - 1]!;
    let residual = 0;
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const p = { x: BUMP.x + dx, y: BUMP.y + dy },
          mapped = mapLocalPoint(alignment, p),
          truthPoint = cameraPoint(p.x, p.y, BUMP.view, true);
        if (mapped)
          residual = Math.max(
            residual,
            Math.hypot(mapped.point.x - truthPoint.x, mapped.point.y - truthPoint.y),
          );
      }
    expect(residual).toBeGreaterThanOrEqual(1.5);
    // Inside the bump no more doubled or moved line columns than the reference alone shows,
    // and no invented ink.
    expect(fused.bump.doubled).toBeLessThanOrEqual(single[0]!.bump.doubled);
    expect(fused.bump.moved).toBeLessThanOrEqual(single[0]!.bump.moved + 1);
    expect(fused.ghosts).toBeLessThanOrEqual(best.ghosts + 25);
    // The bump costs only its own neighbourhood: the page still beats every photograph.
    expect(fused.error).toBeLessThan(best.error * 0.8);
    expect(fused.inkError).toBeLessThan(best.inkError);
  });
});
