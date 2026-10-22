import { describe, expect, it } from 'vitest';
import { fuseViews } from './fusion';

const W = 160,
  H = 120;

function lcg(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
/** Paper 245 with two staves of one-pixel lines (70), noteheads and stems (20). */
function page(): Float64Array {
  const g = new Float64Array(W * H).fill(245);
  const ink = (x: number, y: number, v: number) => {
    if (x >= 0 && y >= 0 && x < W && y < H) g[y * W + x] = Math.min(g[y * W + x]!, v);
  };
  for (const top of [20, 70]) {
    for (let line = 0; line < 5; line++) for (let x = 8; x < W - 8; x++) ink(x, top + line * 6, 70);
    for (let n = 0; n < 9; n++) {
      const x = 16 + n * 16,
        y = top + ((n * 5) % 24);
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -3; dx <= 3; dx++)
          if ((dx * dx) / 10 + (dy * dy) / 5 <= 1) ink(x + dx, y + dy, 20);
      for (let dy = -14; dy <= 0; dy++) ink(x + 3, y + dy, 20);
    }
  }
  return g;
}
function blur(g: Float64Array, sigma: number): Float64Array {
  const r = Math.ceil(sigma * 3),
    k = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma ** 2))),
    total = k.reduce((a, b) => a + b, 0);
  const pass = (src: Float64Array, dx: number, dy: number) => {
    const out = new Float64Array(src.length);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let sum = 0;
        for (let i = -r; i <= r; i++) {
          const sx = Math.max(0, Math.min(W - 1, x + i * dx)),
            sy = Math.max(0, Math.min(H - 1, y + i * dy));
          sum += src[sy * W + sx]! * k[i + r]!;
        }
        out[y * W + x] = sum / total;
      }
    return out;
  };
  return pass(pass(g, 1, 0), 0, 1);
}
/** A photograph of the page: optional blur where mask(x, y) is set, then edit, noise, clipping. */
function view(
  truth: Float64Array,
  seed: number,
  options: {
    blurred?: (x: number, y: number) => boolean;
    edit?: (v: number, x: number, y: number) => number;
  } = {},
): Float64Array {
  const soft = options.blurred ? blur(truth, 2) : truth,
    noise = lcg(seed),
    out = new Float64Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let v = options.blurred?.(x, y) ? soft[i]! : truth[i]!;
      v = options.edit ? options.edit(v, x, y) : v;
      v += (noise() + noise() + noise() - 1.5) * 4;
      out[i] = Math.max(0, Math.min(255, Math.round(v)));
    }
  return out;
}
async function fuse(
  images: Float64Array[],
  options: { width?: number; height?: number; signal?: AbortSignal } = {},
): Promise<Float64Array> {
  const width = options.width ?? W,
    height = options.height ?? H,
    out = new Float64Array(width * height);
  await fuseViews(
    width,
    height,
    images.length,
    (y, values, weights) =>
      images.forEach((image, v) => {
        values[v]!.set(image.subarray(y * width, (y + 1) * width));
        weights[v]!.fill(1);
      }),
    (y, fused) => out.set(fused, y * width),
    options.signal,
  );
  return out;
}
/** Mean absolute error against the page where inside(x, y), away from the image border. */
function error(
  truth: Float64Array,
  image: Float64Array,
  inside: (x: number, y: number) => boolean = () => true,
  ink = false,
) {
  let sum = 0,
    count = 0;
  for (let y = 4; y < H - 4; y++)
    for (let x = 4; x < W - 4; x++) {
      const i = y * W + x;
      if (!inside(x, y) || (ink && truth[i]! >= 100)) continue;
      sum += Math.abs(image[i]! - truth[i]!);
      count++;
    }
  return sum / count;
}

describe('multi-view fusion (issue 143)', () => {
  it('returns a single view exactly, without filtering', async () => {
    const one = view(page(), 3);
    expect(await fuse([one])).toEqual(one);
  });

  it('returns identical views exactly, whatever the height of the last band', async () => {
    for (const height of [61, 5]) {
      const random = lcg(height),
        image = Float64Array.from({ length: W * height }, () => Math.round(random() * 255));
      const out = await fuse([image, image, image, image, image], { height });
      expect(out).toEqual(image);
    }
  });

  it('removes a glare spot that only one photograph has', async () => {
    const truth = page(),
      spot = (x: number, y: number) => Math.hypot(x - 60, y - 32) < 14;
    const glared = view(truth, 1, {
      edit: (v, x, y) => v + 230 * Math.exp(-((x - 60) ** 2 + (y - 32) ** 2) / (2 * 9 * 9)),
    });
    const out = await fuse([glared, view(truth, 2), view(truth, 3), view(truth, 4)]);
    expect(error(truth, glared, spot)).toBeGreaterThan(30);
    expect(error(truth, out, spot)).toBeLessThan(6);
  });

  it('keeps the darker photographs where an even number of views disagree about glare', async () => {
    // Dim paper (about 170), so the glare raises the local mean by up to 70 without clipping:
    // the even-count consensus then sits between the photographs, on neither of them.
    const truth = page().map((v) => v * 0.7),
      spot = (x: number, y: number) => Math.hypot(x - 60, y - 32) < 14,
      glare = (v: number, x: number, y: number) =>
        v + 70 * Math.exp(-((x - 60) ** 2 + (y - 32) ** 2) / (2 * 12 * 12));
    const views = [view(truth, 1, { edit: glare }), view(truth, 2)];
    views.push(view(truth, 3, { edit: glare }), view(truth, 4));
    const out = await fuse(views);
    expect(out.every((v) => Number.isFinite(v) && v >= 0 && v <= 255)).toBe(true);
    expect(error(truth, views[0]!, spot)).toBeGreaterThan(30);
    expect(error(truth, out, spot)).toBeLessThan(6);
  });

  it('lets the reference hold out against a single other photograph', async () => {
    // With two photographs a brighter reference may carry soft glare as well as the other a hand
    // shadow; brightness alone cannot tell them apart, and the reference defines the page. (The
    // camera benchmark's hand shadows, in parts of the page only two photographs cover, painted
    // dark bands; glare that clips the reference still loses, see the safety tests.)
    // Soft glare on the reference therefore stays where only two photographs cover the page
    // (its marks too: the reference's detail is kept); with four, the darker pair wins (above).
    const truth = page().map((v) => v * 0.7),
      shade = (x: number, y: number) => x > 80 && y > 50,
      deep = (x: number, y: number) => x > 92 && y > 62 && truth[y * W + x] === 245 * 0.7;
    const shadowed = view(truth, 2, { edit: (v, x, y) => (shade(x, y) ? v * 0.6 : v) });
    const out = await fuse([view(truth, 1), shadowed]);
    expect(error(truth, shadowed, deep)).toBeGreaterThan(50);
    expect(error(truth, out, deep)).toBeLessThan(4);
  });

  it('rejects a hand shadow that only one photograph has', async () => {
    const truth = page(),
      shade = (x: number, y: number) => x > 80 && y > 50;
    const shadowed = view(truth, 1, { edit: (v, x, y) => (shade(x, y) ? v * 0.6 : v) });
    const out = await fuse([view(truth, 2), shadowed, view(truth, 3)]);
    // Paper well inside the shadow: the shadowed view reads about 147 there.
    const deep = (x: number, y: number) => x > 92 && y > 62 && truth[y * W + x] === 245;
    expect(error(truth, shadowed, deep)).toBeGreaterThan(80);
    expect(error(truth, out, deep)).toBeLessThan(4);
  });

  it('takes the detail from the photograph that is sharp in each region', async () => {
    const truth = page(),
      left = (x: number) => x < W / 2;
    // Each region is sharp in exactly one of three photographs.
    const views = [
      view(truth, 1, { blurred: (x) => left(x) }),
      view(truth, 2, { blurred: (x) => !left(x) }),
      view(truth, 3, { blurred: () => true }),
    ];
    const out = await fuse(views),
      mean = new Float64Array(W * H).map((_, i) => views.reduce((s, v) => s + v[i]!, 0) / 3);
    for (const region of [(x: number) => left(x), (x: number) => !left(x)]) {
      const sharp = views.find((v) => error(truth, v, region, true) < 20)!;
      // Ink stays as dark as in the sharp photograph; a plain average would grey it.
      expect(error(truth, out, region, true)).toBeLessThan(error(truth, sharp, region, true) + 6);
      expect(error(truth, out, region, true)).toBeLessThan(error(truth, mean, region, true) / 2);
    }
  });

  it('never paints a mark that most photographs contradict onto white paper', async () => {
    const white = new Float64Array(W * H).fill(255),
      marked = white.slice();
    for (let y = 40; y < 60; y++) for (let x = 50; x < 80; x++) marked[y * W + x] = 70;
    const out = await fuse([white, marked, marked, white, white]);
    expect(out).toEqual(white);
  });

  it('stops when the signal aborts', async () => {
    const controller = new AbortController();
    controller.abort();
    const image = page();
    await expect(fuse([image, image], { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
