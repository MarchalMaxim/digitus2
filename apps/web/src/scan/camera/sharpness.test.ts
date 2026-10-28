import { describe, expect, it } from 'vitest';
import { staffSharpness, traceStaves } from './sharpness';
import type { Frame } from './vision';

/** A page of grand staves rendered at `scale` x a 1000 x 1400 canvas with interline 10 x scale:
 * staff lines 1.2 px thick (exact pixel coverage), optional noteheads with stems, Gaussian blur. */
function page(options: {
  sigma?: number;
  ink?: number;
  density?: 'dense' | 'sparse' | 'none';
  scale?: number;
  offset?: number;
}): Frame {
  const { sigma = 0, ink = 25, density = 'dense', scale = 1, offset = 0.37 } = options;
  const width = 1000 * scale,
    height = 1400 * scale,
    d = 10 * scale,
    paper = 240;
  const cover = new Float32Array(width * height);
  const fill = (x: number, y: number, c: number) => {
    const i = y * width + x;
    if (c > cover[i]!) cover[i] = c;
  };
  const centers: number[] = [];
  for (let pair = 0; pair < 4; pair++)
    centers.push(150 * scale + pair * 330 * scale, 150 * scale + pair * 330 * scale + 150 * scale);
  centers.forEach((center, staff) => {
    const x0 = Math.round(60 * scale),
      x1 = Math.round(940 * scale);
    for (let k = -2; k <= 2; k++) {
      const yc = center + offset + k * d,
        half = 0.6 * scale;
      for (let y = Math.floor(yc - half - 1); y <= Math.ceil(yc + half + 1); y++) {
        // Pixel y covers [y - 0.5, y + 0.5].
        const overlap = Math.min(y + 0.5, yc + half) - Math.max(y - 0.5, yc - half);
        if (overlap > 0) for (let x = x0; x < x1; x++) fill(x, y, Math.min(1, overlap));
      }
    }
    if (density === 'none') return;
    const step = (density === 'dense' ? 25 : 150) * scale;
    for (let n = 0, x = x0 + 30 * scale; x < x1 - 20 * scale; n++, x += step) {
      // A pitch that wanders over the staff and one ledger position each side.
      const pitch = ((n * 5 + staff * 3) % 11) - 5;
      const cy = center + offset + pitch * (d / 2),
        rx = 6 * scale,
        ry = 4.6 * scale;
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
        for (let xx = Math.floor(x - rx); xx <= Math.ceil(x + rx); xx++)
          if (((xx - x) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) fill(xx, y, 1);
      const up = pitch < 0,
        sx = Math.round(up ? x + rx - 0.6 * scale : x - rx + 0.6 * scale);
      for (let y = Math.round(up ? cy - 3.5 * d : cy); y <= Math.round(up ? cy : cy + 3.5 * d); y++)
        for (let w = 0; w < Math.max(1, Math.round(1.2 * scale)); w++) fill(sx + w, y, 1);
    }
  });
  let lum: Float32Array = new Float32Array(width * height);
  const inkLevel = ink;
  for (let i = 0; i < lum.length; i++) lum[i] = paper - cover[i]! * (paper - inkLevel);
  if (sigma > 0) lum = blur(lum, width, height, sigma);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < lum.length; i++) {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = Math.round(lum[i]!);
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

function blur(src: Float32Array, width: number, height: number, sigma: number): Float32Array {
  const radius = Math.ceil(3 * sigma),
    kernel = new Float32Array(2 * radius + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++)
    sum += kernel[i + radius] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < kernel.length; i++) kernel[i]! /= sum;
  const pass = (from: Float32Array, horizontal: boolean): Float32Array => {
    const to = new Float32Array(from.length);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        let acc = 0;
        for (let k = -radius; k <= radius; k++) {
          const sx = horizontal ? Math.min(width - 1, Math.max(0, x + k)) : x;
          const sy = horizontal ? y : Math.min(height - 1, Math.max(0, y + k));
          acc += from[sy * width + sx]! * kernel[k + radius]!;
        }
        to[y * width + x] = acc;
      }
    return to;
  };
  return pass(pass(src, true), false);
}

const SIGMAS = [0, 0.5, 1, 1.5, 2, 2.5, 3];

describe('staff-line sharpness (edge width per interline)', () => {
  it('is strictly increasing with blur, small for a sharp page and about 2.5 sigma per interline', () => {
    const values = SIGMAS.map((sigma) => {
      const m = staffSharpness(page({ sigma }));
      expect(m, `sigma ${sigma}`).not.toBeNull();
      expect(m!.staves).toBe(8);
      return m!.value;
    });
    for (let i = 1; i < values.length; i++)
      expect(values[i]!, `sigma ${SIGMAS[i]}`).toBeGreaterThan(values[i - 1]!);
    // A sharp line is as wide as it is thick: 1.2 px of a 10 px interline, plus the pixel grid.
    expect(values[0]!).toBeLessThan(0.2);
    // Blur conserves the line's ink and lowers its depth: the width is 2.5 sigma, 0.5 interline at sigma 2.
    expect(values[4]!).toBeGreaterThan(0.45);
    expect(values[4]!).toBeLessThan(0.6);
  });

  it('stays within 10% across ink darkness and note density', () => {
    for (const sigma of [1, 2]) {
      const values = [25, 90].flatMap((ink) =>
        (['dense', 'sparse'] as const).map(
          (density) => staffSharpness(page({ sigma, ink, density }))!.value,
        ),
      );
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      for (const v of values)
        expect(Math.abs(v / mean - 1), `sigma ${sigma}: ${values.join(', ')}`).toBeLessThan(0.1);
    }
  });

  it('is independent of scale: the same page twice as large and twice as blurred', () => {
    const one = staffSharpness(page({ sigma: 1.5 }))!.value;
    const two = staffSharpness(page({ sigma: 3, scale: 2 }))!.value;
    expect(Math.abs(two / one - 1)).toBeLessThan(0.1);
  });

  it('reports the interline and the staves it measured', () => {
    const m = staffSharpness(page({ sigma: 1 }))!;
    expect(m.staves).toBe(8);
    expect(m.interline).toBeGreaterThan(9.5);
    expect(m.interline).toBeLessThan(10.5);
    expect(m.scale).toBe(1);
    expect(m.worst).toBeGreaterThanOrEqual(m.value - 1e-9);
  });

  it('finds nothing to measure on a blank page', () => {
    const data = new Uint8ClampedArray(1000 * 1400 * 4).fill(240);
    expect(staffSharpness({ width: 1000, height: 1400, data })).toBeNull();
  });

  it('traces a sharp page as it is and a page blurred past the tracer by raising its contrast', () => {
    expect(traceStaves(page({ sigma: 0 }))?.traced).toBe('plain');
    const soft = page({ sigma: 3 });
    // Only the raised-contrast copy has staves the tracer accepts; the measure itself reads the original pixels.
    const tracing = traceStaves(soft);
    expect(tracing?.traced).toBe('boosted');
    expect(tracing!.geometry.staves).toHaveLength(8);
    const m = staffSharpness(soft, tracing)!;
    expect(m.traced).toBe('boosted');
    expect(m.staves).toBe(8);
    expect(m.value).toBeGreaterThan(0.6);
    expect(m.value).toBeLessThan(0.8);
  });
});

/** Pages without a single staff: whatever the raised-contrast retrace amplifies, it must not trace these. */
describe('no staves where there are none (the retrace does not invent them)', () => {
  const noStaves = (name: string, frame: Frame) =>
    it(name, () => {
      expect(traceStaves(frame)).toBeNull();
      expect(staffSharpness(frame)).toBeNull();
    });
  const random = (seed: number) => {
    let s = seed;
    return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  };
  const frameOf = (width: number, height: number, luminance: (x: number, y: number) => number) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = luminance(x, y);
        data[i + 3] = 255;
      }
    return { width, height, data } satisfies Frame;
  };

  const sensor = random(7);
  noStaves(
    'sensor noise',
    frameOf(1000, 1400, () => 200 + (sensor() - 0.5) * 60),
  );
  // The faintest noise is the one a gain of 32 turns into strong texture.
  const faint = random(5);
  noStaves(
    'faint noise (gain 32 makes it strong)',
    frameOf(1000, 1400, () => 220 + (faint() - 0.5) * 4),
  );
  const tiles = random(3);
  const blocks = Array.from({ length: 125 * 175 }, () => (tiles() - 0.5) * 40);
  const grain = random(9);
  noStaves(
    'JPEG-like 8 x 8 blocks over grain',
    frameOf(
      1000,
      1400,
      (x, y) => 215 + blocks[Math.floor(y / 8) * 125 + Math.floor(x / 8)]! + (grain() - 0.5) * 8,
    ),
  );
  const ink = new Uint8Array(1000 * 1400);
  for (let line = 0; line < 60; line++) {
    const y0 = 60 + line * 22,
      words = random(line + 11);
    for (let x = 60; x < 920;) {
      const wide = 12 + Math.floor(words() * 50);
      for (let y = y0; y < y0 + 9; y++)
        for (let xx = x; xx < x + wide; xx++) if (words() > 0.15) ink[y * 1000 + xx] = 1;
      x += wide + 8;
    }
  }
  noStaves(
    'a page of text',
    frameOf(1000, 1400, (x, y) => (ink[y * 1000 + x] ? 40 : 235)),
  );
  noStaves(
    'a test card of vertical bars',
    frameOf(1000, 1400, (x) => (Math.floor(x / 7) % 2 ? 40 : 235)),
  );
  noStaves(
    'a test card of diagonal stripes',
    frameOf(1000, 1400, (x, y) => (Math.floor((x + y) / 7) % 2 ? 40 : 235)),
  );
  noStaves(
    'a test card of concentric rings',
    frameOf(1000, 1400, (x, y) => (Math.floor(Math.hypot(x - 500, y - 700) / 8) % 2 ? 40 : 235)),
  );
});
