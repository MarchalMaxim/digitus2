import { describe, expect, it } from 'vitest';
import { validCorners } from './captureState';
import { advise, measureFrame, photographable, type Advice, type FrameQuality } from './quality';
import type { Frame, Point } from './vision';

// Tracking frames are 270x360. Thresholds were calibrated on the owner's phone photos
// (research/omr/photos) blurred at full size and downsized like GuidedCamera does; these
// synthetic frames are rendered at 4x and box-downsampled so their edges are as soft as a
// real tracking frame's, then noised like a sensor.
const W = 270,
  H = 360;
type Gray = Float32Array;

function rng(seed: number) {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
}
function normal(rand: () => number) {
  return Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
}

const scores = new Map<string, Gray>();
/** A page of piano notation: grand-staff systems with note heads, stems and beams. */
function score(systems: number, notes: number, seed = 7): Gray {
  const key = `${systems}/${notes}/${seed}`;
  const cached = scores.get(key);
  if (cached) return cached;
  const S = 4,
    w = W * S,
    h = H * S,
    hi = new Uint8Array(w * h).fill(1),
    rand = rng(seed);
  const rect = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = Math.max(0, Math.round(y0)); y < Math.min(h, Math.round(y1)); y++)
      hi.fill(0, y * w + Math.max(0, Math.round(x0)), y * w + Math.min(w, Math.round(x1)));
  };
  const space = 14,
    left = 60,
    right = w - 60,
    pitch = (h - 240) / systems;
  for (let s = 0; s < systems; s++)
    for (let staff = 0; staff < 2; staff++) {
      const top = 120 + s * pitch + staff * pitch * 0.45;
      for (let line = 0; line < 5; line++)
        rect(left, top + line * space, right, top + line * space + 2);
      rect(left, top, left + 3, top + 4 * space + 2);
      rect(right - 3, top, right, top + 4 * space + 2);
      for (let n = 0; n < notes; n++) {
        const x = left + 40 + ((right - left - 80) * (n + rand() * 0.3)) / notes,
          y = top + Math.floor(rand() * 9) * (space / 2);
        for (let dy = -7; dy <= 7; dy++)
          for (let dx = -10; dx <= 10; dx++)
            if ((dx * dx) / 100 + (dy * dy) / 42 < 1) rect(x + dx, y + dy, x + dx + 1, y + dy + 1);
        rect(x + 8, y - 48, x + 11, y);
        if (n % 2 === 0 && n + 1 < notes && rand() > 0.3)
          rect(x + 8, y - 48, x + 11 + (right - left - 80) / notes, y - 42);
      }
    }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let dy = 0; dy < S; dy++)
        for (let dx = 0; dx < S; dx++) sum += hi[(y * S + dy) * w + x * S + dx]!;
      out[y * W + x] = 40 + (188 * sum) / (S * S);
    }
  scores.set(key, out);
  return out;
}
const dense = () => score(6, 14),
  mid = () => score(4, 8),
  sparse = () => score(2, 3);

function frame(g: Gray, noise = 1.5, seed = 99, w = W, h = H): Frame {
  const rand = rng(seed),
    data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = g[i]! + (noise ? normal(rand) * noise : 0);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
}
function convolve(g: Gray, kx: number[], ky: number[], w = W, h = H): Gray {
  const rx = (kx.length - 1) / 2,
    ry = (ky.length - 1) / 2,
    a = new Float32Array(w * h),
    out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let i = 0; i < kx.length; i++)
        v += kx[i]! * g[y * w + Math.min(w - 1, Math.max(0, Math.round(x + i - rx)))]!;
      a[y * w + x] = v;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let i = 0; i < ky.length; i++)
        v += ky[i]! * a[Math.min(h - 1, Math.max(0, Math.round(y + i - ry))) * w + x]!;
      out[y * w + x] = v;
    }
  return out;
}
function gaussian(g: Gray, sigma: number): Gray {
  const r = Math.ceil(sigma * 3),
    k = Array.from({ length: 2 * r + 1 }, (_, i) =>
      Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)),
    ),
    total = k.reduce((a, b) => a + b);
  const n = k.map((v) => v / total);
  return convolve(g, n, n);
}
/** Straight camera shake during the exposure: a box along one axis. */
function motion(g: Gray, length: number, axis: 'x' | 'y'): Gray {
  const k = new Array<number>(length).fill(1 / length);
  return axis === 'x' ? convolve(g, k, [1]) : convolve(g, [1], k);
}
const scaled = (g: Gray, factor: number) => g.map((v) => v * factor);

/** Independent of production code: solves the homography taking the frame quad onto the page. */
function homography(from: readonly Point[], to: readonly Point[]): number[] {
  const a: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i]!,
      { x: u, y: v } = to[i]!;
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u], [0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[p]![c]!)) p = r;
    [a[c], a[p]] = [a[p]!, a[c]!];
    for (let r = 0; r < 8; r++)
      if (r !== c) {
        const f = a[r]![c]! / a[c]![c]!;
        for (let k = c; k < 9; k++) a[r]![k] = a[r]![k]! - f * a[c]![k]!;
      }
  }
  return [...a.map((row, i) => row[8]! / row[i]!), 1];
}
/** The page (a W x H texture) photographed onto `quad` over a table; 4x supersampled. */
function onTable(
  page: Gray,
  quad: readonly Point[],
  table: (x: number, y: number) => number,
): Gray {
  const m = homography(quad, [
      { x: 0, y: 0 },
      { x: W, y: 0 },
      { x: W, y: H },
      { x: 0, y: H },
    ]),
    out = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (const [ox, oy] of [
        [0.25, 0.25],
        [0.75, 0.25],
        [0.25, 0.75],
        [0.75, 0.75],
      ] as const) {
        const X = x + ox,
          Y = y + oy,
          d = m[6]! * X + m[7]! * Y + 1,
          u = (m[0]! * X + m[1]! * Y + m[2]!) / d,
          v = (m[3]! * X + m[4]! * Y + m[5]!) / d;
        sum +=
          u >= 0 && v >= 0 && u < W && v < H
            ? page[Math.floor(v) * W + Math.floor(u)]!
            : table(x, y);
      }
      out[y * W + x] = sum / 4;
    }
  return out;
}
const quad = [
  { x: 52, y: 40 },
  { x: 222, y: 58 },
  { x: 236, y: 318 },
  { x: 38, y: 304 },
];
const flat = (v: number) => () => v;
function expectOutline(page: Point[] | null, truth: readonly Point[]) {
  expect(page).not.toBeNull();
  for (let i = 0; i < 4; i++) {
    expect(Math.abs(page![i]!.x - truth[i]!.x)).toBeLessThanOrEqual(3);
    expect(Math.abs(page![i]!.y - truth[i]!.y)).toBeLessThanOrEqual(3);
  }
  // The guided camera feeds the outline straight in as its corners.
  expect(validCorners(page!, W, H)).toBe(true);
}

describe('measureFrame', () => {
  it('reports mean luminance and the paper level', () => {
    const half = new Float32Array(W * H).map((_, i) => (i < (W * H) / 2 ? 40 : 220));
    const q = measureFrame(frame(half, 0));
    expect(q.brightness).toBeCloseTo(130, 0);
    expect(q.paper).toBe(220);
    expect(measureFrame(frame(new Float32Array(W * H).fill(120), 0)).brightness).toBeCloseTo(
      120,
      0,
    );
  });

  it('answers a malformed frame without throwing, and never as photographable', () => {
    const q = measureFrame({ width: W, height: H, data: new Uint8ClampedArray(16) });
    expect(q).toMatchObject({ brightness: 0, blur: 1, glare: 0, page: null });
    expect(photographable(q)).toBe(false);
  });

  it('reads sharp notation as crisp however much ink the page has', () => {
    for (const page of [dense(), mid(), sparse()]) {
      const q = measureFrame(frame(page));
      expect(q.blur).toBeLessThan(0.1);
      expect(photographable(q)).toBe(true);
    }
  });

  it('keeps a slight softening photographable', () => {
    // Half a tracking pixel is about two pixels of a 1200 x 1600 photo; the owner's photos
    // read 0.03 to 0.26 there.
    for (const page of [dense(), mid(), sparse()])
      expect(measureFrame(frame(gaussian(page, 0.5))).blur).toBeLessThan(0.2);
  });

  it('reads a blur of one tracking pixel as blurry, nearly independent of ink density', () => {
    // One tracking pixel is about 4.4 photo pixels; the owner's photos read 0.75 to 0.92
    // at 4 photo pixels.
    const blurs = [dense(), mid(), sparse()].map((page) => {
      const q = measureFrame(frame(gaussian(page, 1)));
      expect(photographable(q)).toBe(false);
      return q.blur;
    });
    expect(Math.min(...blurs)).toBeGreaterThan(0.6);
    expect(Math.max(...blurs) - Math.min(...blurs)).toBeLessThan(0.15);
  });

  it('grows with the blur radius, not as a pass-or-fail cliff', () => {
    const blurs = [0, 0.5, 0.75, 1, 1.5, 2].map(
      (sigma) => measureFrame(frame(sigma ? gaussian(mid(), sigma) : mid())).blur,
    );
    for (let i = 1; i < blurs.length; i++) expect(blurs[i]).toBeGreaterThanOrEqual(blurs[i - 1]!);
    expect(blurs[0]).toBeLessThan(0.1);
    expect(blurs[2]).toBeGreaterThan(0.25);
    expect(blurs[2]).toBeLessThan(0.75);
    expect(blurs.at(-1)).toBeGreaterThan(0.9);
  });

  it('reads camera shake in either direction as blurry', () => {
    for (const page of [dense(), mid(), sparse()])
      for (const axis of ['x', 'y'] as const) {
        const q = measureFrame(frame(motion(page, 5, axis)));
        expect(q.blur, axis).toBeGreaterThan(0.5);
        expect(photographable(q)).toBe(false);
      }
  });

  it('is not fooled by sensor noise', () => {
    for (const page of [dense(), sparse()]) {
      expect(measureFrame(frame(page, 3)).blur).toBeLessThan(0.1);
      expect(measureFrame(frame(gaussian(page, 1), 3)).blur).toBeGreaterThan(0.6);
    }
  });

  it('reads a frame with no edges left as fully blurred, even when noisy', () => {
    expect(measureFrame(frame(gaussian(mid(), 5), 1.5)).blur).toBe(1);
    expect(measureFrame(frame(new Float32Array(W * H).fill(228), 1.5)).blur).toBe(1);
  });

  it('flags a dim frame as dark, but not the dim warm light of a readable photo', () => {
    // The owner's dimmest real photo has its paper at 133 and its mean at 110.
    const readable = measureFrame(frame(scaled(mid(), 133 / 228)));
    expect(readable.paper).toBeGreaterThan(120);
    expect(photographable(readable)).toBe(true);
    const dim = measureFrame(frame(scaled(mid(), 0.3), 3));
    expect(advise([dim, dim])).toBe('dark');
    expect(photographable(dim)).toBe(false);
  });

  it('measures blown-out glare as a share of the page', () => {
    const page = onTable(mid(), quad, flat(35)),
      glared = page.slice();
    // A specular spot 48 px across washes out the ink under it.
    const cx = 140,
      cy = 170;
    let spot = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= 24 ** 2) {
          glared[y * W + x] = 255;
          spot++;
        }
    const pageArea =
      Math.abs(
        quad.reduce((s, p, i) => s + p.x * quad[(i + 1) % 4]!.y - quad[(i + 1) % 4]!.x * p.y, 0),
      ) / 2;
    const clean = measureFrame(frame(page, 1)),
      q = measureFrame(frame(glared, 1));
    expect(clean.glare).toBe(0);
    expect(q.page).not.toBeNull();
    expect(q.glare).toBeGreaterThan((0.8 * spot) / pageArea);
    expect(q.glare).toBeLessThan((1.1 * spot) / pageArea);
    // Without an outline the share is of the whole frame.
    const full = mid().slice();
    for (let i = 0; i < W * 60; i++) full[i] = 255;
    expect(measureFrame(frame(full, 0)).glare).toBeCloseTo(60 / H, 1);
  });
});

describe('page outline', () => {
  it('finds a perspective page on a dark table, clockwise from top-left', () => {
    expectOutline(measureFrame(frame(onTable(mid(), quad, flat(35)), 2)).page, quad);
  });

  it('finds the same page on a mid-grey table', () => {
    expectOutline(measureFrame(frame(onTable(mid(), quad, flat(120)), 2)).page, quad);
  });

  it('finds a dense page on a cluttered table', () => {
    const clutter = (x: number, y: number) =>
      x < 34 && y < 120
        ? 150
        : x > 244 && y > 130 && y < 210
          ? 205
          : x < 30 && y > 320
            ? 90
            : y > 334 && x > 90 && x < 200 && y < 340
              ? 170
              : 45 + 20 * Math.sin(x / 7) * Math.sin(y / 11);
    expectOutline(measureFrame(frame(onTable(dense(), quad, clutter), 2)).page, quad);
  });

  it('turns with the page: corners stay clockwise from top-left', () => {
    const turned = [
      { x: 70, y: 22 },
      { x: 250, y: 70 },
      { x: 205, y: 335 },
      { x: 22, y: 285 },
    ];
    expectOutline(measureFrame(frame(onTable(sparse(), turned, flat(30)), 2)).page, turned);
  });

  it('returns null when the page fills the frame', () => {
    expect(measureFrame(frame(dense())).page).toBeNull();
    const overfilled = [
      { x: -20, y: -30 },
      { x: 290, y: -10 },
      { x: 280, y: 330 },
      { x: -10, y: 340 },
    ];
    expect(measureFrame(frame(onTable(mid(), overfilled, flat(35)), 2)).page).toBeNull();
  });

  it('returns null for a dark frame and for paper that does not stand out', () => {
    expect(measureFrame(frame(new Float32Array(W * H).fill(25), 2)).page).toBeNull();
    expect(measureFrame(frame(onTable(mid(), quad, flat(220)), 2)).page).toBeNull();
  });

  it('measures blur inside the outline, so a sharp table grain does not count', () => {
    const blurred = gaussian(onTable(mid(), quad, flat(60)), 1.2),
      rand = rng(5),
      inside = (x: number, y: number) =>
        quad.every((a, i) => {
          const b = quad[(i + 1) % 4]!;
          return (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) >= -2;
        });
    // Wood grain: crisp light and dark streaks on the table only.
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (!inside(x, y)) blurred[y * W + x] = 60 + (rand() < 0.3 ? 90 * rand() : 0);
    const q = measureFrame(frame(blurred));
    expect(q.page).not.toBeNull();
    expect(q.blur).toBeGreaterThan(0.6);
  });
});

const quality = (patch: Partial<FrameQuality>): FrameQuality => ({
  brightness: 160,
  blur: 0.05,
  glare: 0,
  page: quad,
  paper: 200,
  ...patch,
});
const sharp = quality({}),
  blurred = quality({ blur: 0.8 }),
  missing = quality({ page: null }),
  darkened = quality({ brightness: 40, paper: 50 });
/** Drives advise as the viewfinder does: one reading per tick, the last five passed in. */
function run(readings: FrameQuality[]): Advice[] {
  return readings.map((_, i) => advise(readings.slice(Math.max(0, i - 4), i + 1)));
}

describe('advise', () => {
  it('ranks dark over blurry over a missing page', () => {
    expect(advise([darkened, darkened])).toBe('dark');
    expect(advise([quality({ ...darkened, blur: 0.9 }), quality({ ...darkened, blur: 0.9 })])).toBe(
      'dark',
    );
    expect(advise([quality({ blur: 0.9, page: null }), quality({ blur: 0.9, page: null })])).toBe(
      'blurry',
    );
    expect(advise([missing, missing])).toBe('noPage');
    expect(advise([sharp, sharp])).toBe('good');
  });

  it('works from the four required fields alone', () => {
    const bare = (q: Omit<FrameQuality, 'paper'>) => [q, q];
    expect(advise(bare({ brightness: 30, blur: 0, glare: 0, page: null }))).toBe('dark');
    expect(advise(bare({ brightness: 150, blur: 0.9, glare: 0, page: null }))).toBe('blurry');
    expect(advise(bare({ brightness: 150, blur: 0, glare: 0, page: quad }))).toBe('good');
    expect(photographable({ brightness: 30, blur: 0, glare: 0, page: null })).toBe(false);
  });

  it('answers before there are two readings', () => {
    expect(advise([])).toBe('good');
    expect(advise([blurred])).toBe('blurry');
  });

  it('ignores a single odd frame', () => {
    const readings = [...Array(6).fill(sharp), blurred, ...Array(6).fill(sharp)];
    expect(run(readings).every((a) => a === 'good')).toBe(true);
    const dim = [...Array(6).fill(blurred), darkened, ...Array(6).fill(blurred)];
    expect(run(dim).every((a) => a === 'blurry')).toBe(true);
  });

  it('switches on the second consistent frame', () => {
    const out = run([...Array(6).fill(sharp), ...Array(4).fill(blurred)]);
    expect(out.slice(0, 7).every((a) => a === 'good')).toBe(true);
    expect(out.slice(7).every((a) => a === 'blurry')).toBe(true);
  });

  it('holds steady when the readings alternate', () => {
    const readings = Array.from({ length: 16 }, (_, i) => (i % 2 ? blurred : sharp));
    expect(new Set(run(readings).slice(2)).size).toBe(1);
    const flicker = [
      ...Array(6).fill(sharp),
      ...Array.from({ length: 10 }, (_, i) => (i % 2 ? sharp : blurred)),
    ];
    const out = run(flicker);
    // One change at most once both readings fill the window, then no flicker.
    let changes = 0;
    for (let i = 1; i < out.length; i++) if (out[i] !== out[i - 1]) changes++;
    expect(changes).toBeLessThanOrEqual(1);
  });

  it('holds a message through borderline readings while a clear one is in the window', () => {
    // The hysteresis lasts the five-frame window (about 0.6 s at 120 ms), not forever.
    const edge = quality({ blur: 0.42 }),
      out = run([...Array(4).fill(blurred), ...Array(4).fill(edge), ...Array(3).fill(sharp)]);
    expect(out.slice(0, 8).every((a) => a === 'blurry')).toBe(true);
    expect(out.at(-1)).toBe('good');
    expect(run([...Array(4).fill(blurred), ...Array(5).fill(edge)]).at(-1)).toBe('good');
    // The same borderline reading from a good state does not trigger the message.
    expect(run([...Array(4).fill(sharp), ...Array(4).fill(edge)]).every((a) => a === 'good')).toBe(
      true,
    );
  });
});

describe('photographable', () => {
  it('needs light and focus but not a page outline', () => {
    expect(photographable(missing)).toBe(true);
    expect(photographable(sharp)).toBe(true);
    expect(photographable(blurred)).toBe(false);
    expect(photographable(darkened)).toBe(false);
  });
});
