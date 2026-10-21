import { describe, expect, it } from 'vitest';
import type { Frame, Point } from './vision';
import { alignLocalView, mapLocalPoint } from './localRegistration';

const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const region = [
  { x: 0, y: 0 },
  { x: 420, y: 0 },
  { x: 420, y: 540 },
  { x: 0, y: 540 },
];
function page(seed = 42): Frame {
  const width = 420,
    height = 540,
    data = new Uint8ClampedArray(width * height * 4).fill(255);
  const ink = (x: number, y: number, v = 25) => {
    if (x >= 0 && y >= 0 && x < width && y < height) data.set([v, v, v, 255], (y * width + x) * 4);
  };
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let top = 35; top < height - 35; top += 70) {
    for (let line = 0; line < 5; line++)
      for (let x = 15; x < width - 15; x++) ink(x, top + line * 6, 100);
    for (let n = 0; n < 20; n++) {
      const x = 20 + n * 19 + Math.floor(random() * 6),
        y = top + Math.floor(random() * 27);
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -3; dx <= 3; dx++)
          if ((dx * dx) / 12 + (dy * dy) / 6 <= 1) ink(x + dx, y + dy);
      for (let dy = -10 - Math.floor(random() * 15); dy <= 0; dy++) ink(x + 3, y + dy);
    }
  }
  return { width, height, data };
}
function curved(p: Point): Point {
  return {
    x: p.x + 5 * Math.sin(p.y / 105),
    y: p.y + 7 * Math.sin(p.x / 125) * Math.sin(p.y / 170),
  };
}
function warp(source: Frame, blur = false, occlude = false): Frame {
  const data = new Uint8ClampedArray(source.data.length).fill(255);
  for (let y = 0; y < source.height; y++)
    for (let x = 0; x < source.width; x++) {
      let sx = x,
        sy = y;
      for (let i = 0; i < 8; i++) {
        const q = curved({ x: sx, y: sy });
        sx += x - q.x;
        sy += y - q.y;
      }
      let value = 0,
        count = 0;
      const radius = blur ? 1 : 0;
      for (let oy = -radius; oy <= radius; oy++)
        for (let ox = -radius; ox <= radius; ox++) {
          const ix = Math.round(sx + ox),
            iy = Math.round(sy + oy);
          value +=
            ix >= 0 && iy >= 0 && ix < source.width && iy < source.height
              ? source.data[(iy * source.width + ix) * 4]!
              : 255;
          count++;
        }
      if (occlude && x > 160 && x < 260 && y > 190 && y < 320) value = 255 * count;
      data.set([value / count, value / count, value / count, 255], (y * source.width + x) * 4);
    }
  return { width: source.width, height: source.height, data };
}
describe('local view registration', () => {
  it('measures distributed evidence and supported coverage within a central selected page', async () => {
    const notation = page(),
      width = 840,
      height = 1080;
    const reference: Frame = {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4).fill(255),
    };
    const current: Frame = { width, height, data: reference.data.slice() };
    for (let y = 0; y < notation.height; y++)
      for (let x = 0; x < notation.width; x++) {
        const i = (y * notation.width + x) * 4;
        reference.data.set(notation.data.subarray(i, i + 4), ((y + 270) * width + x + 210) * 4);
        current.data.set(notation.data.subarray(i, i + 4), ((y + 310) * width + x + 260) * 4);
      }
    const selected = [
      { x: 210, y: 270 },
      { x: 629, y: 270 },
      { x: 629, y: 809 },
      { x: 210, y: 809 },
    ];
    const alignment = await alignLocalView(
      reference,
      current,
      [1, 0, 50, 0, 1, 40, 0, 0, 1],
      selected,
    );
    expect(alignment.diagnostics.coverage).toBeGreaterThan(0.7);
    expect(alignment.diagnostics.coverage).toBeLessThanOrEqual(1);
    const mapped = mapLocalPoint(alignment, { x: 400, y: 500 });
    expect(mapped).not.toBeNull();
    expect(mapped!.point.x).toBeCloseTo(450, 1);
    expect(mapped!.point.y).toBeCloseTo(540, 1);
  });
  it('recovers varying curvature in reference-to-current sampling coordinates', async () => {
    const reference = page(),
      alignment = await alignLocalView(reference, warp(reference), identity, region);
    const errors: number[] = [];
    for (let y = 65; y < 490; y += 40)
      for (let x = 55; x < 380; x += 40) {
        const p = { x, y },
          actual = mapLocalPoint(alignment, p),
          expected = curved(p);
        if (actual)
          errors.push(Math.hypot(actual.point.x - expected.x, actual.point.y - expected.y));
      }
    expect(errors.length).toBeGreaterThan(45);
    errors.sort((a, b) => a - b);
    expect(errors[Math.floor(errors.length * 0.9)]).toBeLessThan(1.2);
    expect(mapLocalPoint(alignment, { x: -10, y: 200 })).toBeNull();
  });
  it('keeps trustworthy support with blur and refuses an occluded interior', async () => {
    const reference = page(),
      alignment = await alignLocalView(reference, warp(reference, true, true), identity, region);
    expect(mapLocalPoint(alignment, { x: 210, y: 250 })).toBeNull();
    const actual = mapLocalPoint(alignment, { x: 90, y: 110 });
    expect(actual).not.toBeNull();
    expect(
      Math.hypot(
        actual!.point.x - curved({ x: 90, y: 110 }).x,
        actual!.point.y - curved({ x: 90, y: 110 }).y,
      ),
    ).toBeLessThan(1.5);
  });
  it('rejects different notes on identical staff lines and a badly seeded view', async () => {
    await expect(alignLocalView(page(), page(991), identity, region)).rejects.toThrow(/alignment/i);
    await expect(
      alignLocalView(page(), warp(page()), [1, 0, 90, 0, 1, 60, 0, 0, 1], region),
    ).rejects.toThrow(/alignment/i);
  });
  it('honours cancellation before allocating image work', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      alignLocalView(page(), page(), identity, region, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('cancels during matching and rejects folds or invalid image budgets', async () => {
    const controller = new AbortController();
    const result = alignLocalView(page(), page(), identity, region, controller.signal);
    setTimeout(() => controller.abort(), 5);
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await expect(
      alignLocalView(page(), page(), [-1, 0, 420, 0, 1, 0, 0, 0, 1], region),
    ).rejects.toThrow(/alignment/i);
    await expect(
      alignLocalView(
        { width: 3000, height: 3000, data: new Uint8ClampedArray(0) },
        page(),
        identity,
        region,
      ),
    ).rejects.toThrow(/alignment/i);
  });
});
