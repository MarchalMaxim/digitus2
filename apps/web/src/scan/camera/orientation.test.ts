import { describe, expect, it } from 'vitest';
import {
  detectOrientation,
  downscaleForAnalysis,
  ORIENTATION_LIMITS,
  readOrientation,
  rotateFrame,
} from './orientation';
import type { Frame } from './vision';

const W = 700;
const H = 1000;
const PAPER = 235;
const CENTRES = [
  [150, 260],
  [420, 530],
  [690, 800],
];
const SPACING = 10;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function blank(width: number, height: number, value = PAPER): Frame {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = value;
    data[i * 4 + 1] = value;
    data[i * 4 + 2] = value;
  }
  return { width, height, data };
}

function fill(f: Frame, x0: number, y0: number, x1: number, y1: number, value = 20): void {
  for (let y = Math.max(0, y0); y <= Math.min(f.height - 1, y1); y++)
    for (let x = Math.max(0, x0); x <= Math.min(f.width - 1, x1); x++) {
      const i = (y * f.width + x) * 4;
      f.data[i] = value;
      f.data[i + 1] = value;
      f.data[i + 2] = value;
    }
}

function ring(f: Frame, cx: number, cy: number, radius: number, thickness: number): void {
  for (let y = cy - radius - thickness; y <= cy + radius + thickness; y++)
    for (let x = cx - radius - thickness; x <= cx + radius + thickness; x++) {
      const r = Math.hypot(x - cx, y - cy);
      if (r >= radius - thickness / 2 && r <= radius + thickness / 2) fill(f, x, y, x, y);
    }
}

interface PageOptions {
  clefs?: boolean;
  notes?: boolean;
  ruled?: boolean;
  /** The barline that closes each staff at the right end. */
  closing?: boolean;
  /** A solid block of ink over the whole start of each staff, taller than the windows. */
  dense?: boolean;
  /** An 11 px final bar at the right end of each staff. */
  heavy?: boolean;
}

/** An upright page of three grand staves: the staves start with a brace, a clef and a key
 * signature at the left and end with a barline at the right. */
function page({
  clefs = true,
  notes = true,
  ruled = false,
  closing = true,
  dense = false,
  heavy = false,
}: PageOptions = {}): Frame {
  const f = blank(W, H);
  if (ruled) {
    for (let y = 20; y < H - 20; y += 12) fill(f, 0, y, W - 1, y + 1);
    return f;
  }
  const random = rng(7);
  for (const system of CENTRES) {
    for (const c of system) {
      for (let l = -2; l <= 2; l++) fill(f, 60, c + SPACING * l, 660, c + SPACING * l + 1);
      if (clefs) {
        fill(f, 66, c - 30, 70, c + 30);
        ring(f, 80, c + 5, 8, 3);
        fill(f, 92, c - 12, 96, c + 8);
        fill(f, 102, c - 12, 106, c + 8);
      }
      if (notes)
        for (let x = 130; x <= 600; x += 45) {
          const y = c + Math.round((random() * 8 - 4) * (SPACING / 2));
          fill(f, x, y - 2, x + 5, y + 2);
          fill(f, x + 5, y - 30, x + 6, y);
        }
      if (dense) fill(f, 64, c - 30, 95, c + 30);
      if (heavy) fill(f, 650, c - 20, 660, c + 20);
      for (const x of closing ? [250, 420, 658] : [250, 420]) fill(f, x, c - 20, x + 1, c + 20);
    }
    if (clefs) fill(f, 48, system[0]! - 20, 52, system[1]! + 20);
  }
  return f;
}

/** A frame with the turn applied clockwise k times. */
const expectedTurn = (k: number): number => ((4 - k) % 4) * 90;

const BUDGET = 20_000;

describe('rotateFrame', () => {
  const distinct = (): Frame => {
    const data = new Uint8ClampedArray(3 * 2 * 4);
    for (let i = 0; i < 6; i++) {
      data[i * 4] = i * 10;
      data[i * 4 + 1] = i * 10 + 1;
      data[i * 4 + 2] = i * 10 + 2;
      data[i * 4 + 3] = 255;
    }
    return { width: 3, height: 2, data };
  };
  const pixel = (f: Frame, x: number, y: number): number => f.data[(y * f.width + x) * 4]!;

  it('turns a 3x2 frame clockwise by one quarter', () => {
    const f = distinct();
    const r = rotateFrame(f, 1);
    expect([r.width, r.height]).toEqual([2, 3]);
    // The top-left source pixel lands at the top-right.
    expect(pixel(r, f.height - 1, 0)).toBe(pixel(f, 0, 0));
    expect(rotateFrame(r, 3)).toEqual(f);
  });

  it('two half turns give the frame back', () => {
    const f = distinct();
    const r = rotateFrame(f, 2);
    expect([r.width, r.height]).toEqual([3, 2]);
    expect(rotateFrame(r, 2)).toEqual(f);
  });
});

describe('downscaleForAnalysis', () => {
  it(
    'halves a 2000x3000 frame and keeps a 2 px dark line dark',
    () => {
      const f = blank(2000, 3000);
      fill(f, 0, 1000, 1999, 1001);
      const r = downscaleForAnalysis(f);
      expect([r.width, r.height]).toEqual([1000, 1500]);
      expect(r.data[(500 * r.width + 400) * 4]!).toBeLessThan(128);
    },
    BUDGET,
  );

  it('returns a small frame as it is', () => {
    const f = blank(700, 1000);
    expect(downscaleForAnalysis(f)).toBe(f);
  });
});

describe('detectOrientation', () => {
  it.each([
    ['an upright page needs 0', 0],
    ['a page turned 90° clockwise needs 270', 1],
    ['a page turned 180° needs 180', 2],
    ['a page turned 270° clockwise needs 90', 3],
  ] as const)(
    '%s',
    (_name, k) => {
      const result = detectOrientation(rotateFrame(page(), k));
      expect(result?.turn).toBe(expectedTurn(k));
      expect(result!.confidence).toBeGreaterThan(0);
      expect(result!.confidence).toBeLessThanOrEqual(1);
    },
    BUDGET,
  );

  it(
    'abstains on a blank page with noise',
    () => {
      const f = blank(W, H);
      const random = rng(3);
      for (let i = 0; i < W * H; i++) {
        const v = PAPER + Math.round((random() * 2 - 1) * 10);
        f.data[i * 4] = f.data[i * 4 + 1] = f.data[i * 4 + 2] = v;
      }
      expect(detectOrientation(f)).toBeNull();
    },
    BUDGET,
  );

  it(
    'abstains on ruled notebook paper',
    () => {
      expect(detectOrientation(page({ ruled: true }))).toBeNull();
    },
    BUDGET,
  );

  it(
    'abstains when only the closing barlines mark the ends',
    () => {
      const { orientation, evidence } = readOrientation(page({ clefs: false, notes: false }));
      // The barlines are a right cue and the read leans upside down; the module abstains because
      // the ink at the heavier end is under minInk.
      expect(evidence.side).toBeLessThan(-0.9);
      expect(Math.max(evidence.left, evidence.right) / evidence.staves).toBeLessThan(
        ORIENTATION_LIMITS.minInk,
      );
      expect(orientation).toBeNull();
    },
    BUDGET,
  );

  it(
    'abstains when no staff end carries any cue',
    () => {
      const { orientation, evidence } = readOrientation(
        page({ clefs: false, notes: false, closing: false }),
      );
      expect(evidence.staves).toBeGreaterThanOrEqual(2);
      expect(evidence.side).toBeCloseTo(0, 1);
      expect(orientation).toBeNull();
    },
    BUDGET,
  );

  it(
    'does not turn an upright page whose clef is a solid block beside a heavy final bar',
    () => {
      const { orientation, evidence } = readOrientation(
        page({ clefs: false, notes: false, dense: true, heavy: true }),
      );
      expect(evidence.left).toBeGreaterThan(0);
      expect(orientation === null || orientation.turn === 0).toBe(true);
    },
    BUDGET,
  );

  it(
    'abstains on a frame too small to analyse',
    () => {
      expect(detectOrientation(blank(50, 50))).toBeNull();
    },
    BUDGET,
  );
});
