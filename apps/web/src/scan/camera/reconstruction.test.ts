import { describe, expect, it } from 'vitest';
import { reconstructPage } from './reconstruction';
import type { Capture, Frame } from './vision';
import { mapLocalPoint } from './localRegistration';

const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
function image(width = 120, height = 100): Frame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) data.set([x + y, x + y, x + y, 255], (y * width + x) * 4);
  return { width, height, data };
}
const corners = [
  { x: 0, y: 0 },
  { x: 119, y: 0 },
  { x: 119, y: 99 },
  { x: 0, y: 99 },
];
function score(seed = 42): Frame {
  const width = 420,
    height = 540,
    data = new Uint8ClampedArray(width * height * 4).fill(245);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const ink = (x: number, y: number, v = 20) => {
    if (x >= 0 && y >= 0 && x < width && y < height) data.set([v, v, v, 255], (y * width + x) * 4);
  };
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let top = 35; top < height - 35; top += 70) {
    for (let line = 0; line < 5; line++)
      for (let x = 15; x < width - 15; x++) ink(x, top + line * 6, 90);
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
const scoreCorners = [
  { x: 0, y: 0 },
  { x: 419, y: 0 },
  { x: 419, y: 539 },
  { x: 0, y: 539 },
];
function cameraPoint(x: number, y: number, view: number) {
  const sign = view % 2 ? 1 : -1;
  return {
    x: x + sign * 5 * Math.sin(y / 105) + view * 2,
    y: y + sign * 7 * Math.sin(x / 125) * Math.sin(y / 170) - view * 2,
  };
}
/** Independent inverse renderer: analytical curved surface motion plus separate
 * sensor samples. It never calls the production homography or local map. */
function photograph(source: Frame, view: number): Frame {
  const data = new Uint8ClampedArray(source.data.length).fill(255);
  const at = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < source.width && y < source.height
      ? source.data[(y * source.width + x) * 4]!
      : 245;
  for (let y = 0; y < source.height; y++)
    for (let x = 0; x < source.width; x++) {
      let sx = x,
        sy = y;
      for (let i = 0; i < 8; i++) {
        const q = cameraPoint(sx, sy, view);
        sx += x - q.x;
        sy += y - q.y;
      }
      const ix = Math.floor(sx),
        iy = Math.floor(sy),
        dx = sx - ix,
        dy = sy - iy;
      const value =
        (at(ix, iy) * (1 - dx) + at(ix + 1, iy) * dx) * (1 - dy) +
        (at(ix, iy + 1) * (1 - dx) + at(ix + 1, iy + 1) * dx) * dy +
        ((x * 17 + y * 13 + view) % 5) -
        2;
      data.set([value, value, value, 255], (y * source.width + x) * 4);
    }
  return { width: source.width, height: source.height, data };
}
describe('score page reconstruction', () => {
  it('accepts one actual photograph without manufactured extra captures', async () => {
    const original = image();
    const result = await reconstructPage([{ frame: original, matrix: identity }], corners);
    expect(result.frame).toEqual(original);
    expect(result.alignments).toHaveLength(0);
    expect(result.contributions.views).toEqual([]);
    expect(result.staff).toBeNull();
  });
  it('preserves subpixel sampling and keeps both crop endpoints', async () => {
    const result = await reconstructPage(
      [{ frame: image(), matrix: identity }],
      [
        { x: 10.25, y: 8.4 },
        { x: 109.25, y: 8.4 },
        { x: 109.25, y: 77.4 },
        { x: 10.25, y: 77.4 },
      ],
    );
    expect(result.frame.width).toBe(100);
    expect(result.frame.height).toBe(70);
    expect(result.frame.data[(15 * 100 + 20) * 4]).toBe(54);
  });
  it('rejects invalid input counts and non-reference coordinates', async () => {
    await expect(reconstructPage([], corners)).rejects.toThrow(/capture/i);
    const capture = { frame: image(), matrix: identity };
    await expect(
      reconstructPage(
        Array.from({ length: 6 }, () => capture),
        corners,
      ),
    ).rejects.toThrow(/capture/i);
    await expect(
      reconstructPage([{ ...capture, matrix: [1, 0, 10, 0, 1, 0, 0, 0, 1] }], corners),
    ).rejects.toThrow(/reference/i);
  });
  it('yields and cancels before producing an output', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 0);
    await expect(
      reconstructPage([{ frame: image(), matrix: identity }], corners, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('aligns four independently curved photographs and uses every view without moving or inventing musical marks', async () => {
    const original = score(),
      reference = { ...original, data: original.data.slice() };
    // An annotation visible only in the reference must survive disagreement.
    const annotation = (280 * original.width + 205) * 4;
    reference.data.set([0, 0, 0, 255], annotation);
    const captures: Capture[] = [{ frame: reference, matrix: identity }];
    for (let view = 1; view <= 4; view++)
      captures.push({
        frame: photograph(original, view),
        matrix: [1, 0, view * 2 + 1.2, 0, 1, -view * 2 - 0.8, 0, 0, 1],
      });
    const result = await reconstructPage(captures, scoreCorners);
    expect(result.frame.width).toBe(420);
    expect(result.frame.height).toBe(540);
    expect(result.staff).toBeNull();
    expect(result.alignments).toHaveLength(4);
    for (let view = 0; view < 4; view++) {
      expect(result.contributions.views[view]).toBeGreaterThan(30_000);
      expect(result.contributions.darkSamples[view]).toBeGreaterThan(1000);
      const errors: number[] = [];
      for (let y = 65; y < 490; y += 45)
        for (let x = 65; x < 380; x += 45) {
          const actual = mapLocalPoint(result.alignments[view]!, { x, y });
          if (!actual) continue;
          const expected = cameraPoint(x, y, view + 1);
          errors.push(Math.hypot(actual.point.x - expected.x, actual.point.y - expected.y));
        }
      errors.sort((a, b) => a - b);
      expect(errors.length).toBeGreaterThan(35);
      expect(errors[Math.floor(errors.length * 0.9)]).toBeLessThan(1.2);
    }
    let movedMarks = 0,
      changedInkSamples = 0;
    for (let i = 0; i < reference.data.length; i += 4) {
      if (result.frame.data[i]! < 120 !== reference.data[i]! < 120) movedMarks++;
      if (reference.data[i]! < 120 && result.frame.data[i] !== reference.data[i])
        changedInkSamples++;
    }
    expect(movedMarks).toBe(0);
    // The output must contain measured view evidence on ink, not just report
    // successful registrations while silently returning the reference image.
    expect(changedInkSamples).toBeGreaterThan(500);
    // Fusion takes the mark's detail from the one sharp view but the paper's local mean from
    // all views (issue 143), so the reference-only mark survives a few levels above black.
    expect(result.frame.data[annotation]).toBeLessThan(30);
  }, 30_000);
  it('rejects a different page with the same staff layout and unsupported featureless extra views', async () => {
    await expect(
      reconstructPage(
        [
          { frame: score(), matrix: identity },
          { frame: score(991), matrix: identity },
        ],
        scoreCorners,
      ),
    ).rejects.toThrow(/alignment/i);
    await expect(
      reconstructPage(
        [
          { frame: image(), matrix: identity },
          { frame: image(), matrix: identity },
        ],
        corners,
      ),
    ).rejects.toThrow(/alignment/i);
  });
});
