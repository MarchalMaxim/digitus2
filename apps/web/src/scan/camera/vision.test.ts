import { describe, expect, it } from 'vitest';
import {
  mergeCaptures,
  prepareReference,
  project,
  registerFrame,
  sharpness,
  contentBounds,
  type Frame,
} from './vision';
import { reconstructPage } from './reconstruction';

const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
function blank(width = 300, height = 360, value = 245): Frame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([value, value, value, 255], i);
  return { width, height, data };
}
function ink(f: Frame, x: number, y: number, value = 20) {
  if (x >= 0 && y >= 0 && x < f.width && y < f.height)
    f.data.set([value, value, value, 255], (Math.floor(y) * f.width + Math.floor(x)) * 4);
}
/** Five systems of notation; fewer leave the rest of the page blank (issue 147). */
function notation(seed = 17, systems = 5): Frame {
  const f = blank();
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let system = 0; system < systems; system++) {
    const top = 25 + system * 65;
    for (let line = 0; line < 5; line++)
      for (let x = 15; x < 285; x++) ink(f, x, top + line * 5, 90);
    for (let note = 0; note < 16; note++) {
      const x = 20 + note * 16 + Math.floor(rand() * 5),
        y = top + Math.floor(rand() * 30);
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -3; dx <= 3; dx++)
          if ((dx * dx) / 10 + (dy * dy) / 5 < 1) ink(f, x + dx, y + dy);
      for (let dy = -14 - Math.floor(rand() * 8); dy <= 0; dy++) ink(f, x + 3, y + dy);
      if (rand() > 0.6)
        for (let dx = 0; dx < 7; dx++) ink(f, x + 3 + dx, y - 13 + Math.floor(dx / 2));
    }
  }
  return f;
}
// Independent inverse warp: does not call the production project/solver.
function warp(f: Frame, h: number[], width = f.width, height = f.height): Frame {
  const [a, b, c, d, e, g, p, q, r] = h as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const inv = [
    e * r - g * q,
    c * q - b * r,
    b * g - c * e,
    g * p - d * r,
    a * r - c * p,
    c * d - a * g,
    d * q - e * p,
    b * p - a * q,
    a * e - b * d,
  ];
  const out = blank(width, height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const w = inv[6]! * x + inv[7]! * y + inv[8]!;
      const sx = Math.round((inv[0]! * x + inv[1]! * y + inv[2]!) / w),
        sy = Math.round((inv[3]! * x + inv[4]! * y + inv[5]!) / w);
      if (sx >= 0 && sy >= 0 && sx < f.width && sy < f.height)
        out.data.set(
          f.data.subarray((sy * f.width + sx) * 4, (sy * f.width + sx) * 4 + 4),
          (y * width + x) * 4,
        );
    }
  return out;
}
const corners = [
  { x: 0, y: 0 },
  { x: 299, y: 0 },
  { x: 299, y: 359 },
  { x: 0, y: 359 },
];
function multiplyMatrix(a: number[], b: number[]): number[] {
  return Array.from({ length: 9 }, (_, i) => {
    const row = Math.floor(i / 3),
      col = i % 3;
    return a[row * 3]! * b[col]! + a[row * 3 + 1]! * b[col + 3]! + a[row * 3 + 2]! * b[col + 6]!;
  });
}
function inverseMatrix(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  return [
    e * i - f * h,
    c * h - b * i,
    b * f - c * e,
    f * g - d * i,
    a * i - c * g,
    c * d - a * f,
    d * h - e * g,
    b * g - a * h,
    a * e - b * d,
  ];
}
function cameraPlane(ax: number, ay: number, tx: number, ty: number): number[] {
  const rotation = multiplyMatrix(
    [Math.cos(ay), 0, Math.sin(ay), 0, 1, 0, -Math.sin(ay), 0, Math.cos(ay)],
    [1, 0, 0, 0, Math.cos(ax), -Math.sin(ax), 0, Math.sin(ax), Math.cos(ax)],
  );
  const aspect = 210 / 297;
  return multiplyMatrix(
    [1800, 0, 500, 0, 1800, 500, 0, 0, 1],
    [
      rotation[0]! * aspect,
      rotation[1]!,
      tx,
      rotation[3]! * aspect,
      rotation[4]!,
      ty,
      rotation[6]! * aspect,
      rotation[7]!,
      2,
    ],
  );
}
function oraclePoint(h: number[], x: number, y: number) {
  const z = h[6]! * x + h[7]! * y + h[8]!;
  return { x: (h[0]! * x + h[1]! * y + h[2]!) / z, y: (h[3]! * x + h[4]! * y + h[5]!) / z };
}
describe('score camera registration', () => {
  it.each([
    [1, 0, 0, 0, 1, 0, 0, 0, 1],
    [1, 0, 72, 0, 1, -62, 0, 0, 1],
    [1, 0, -67.5, 0, 1, 81, 0, 0, 1],
    [0.94, -0.035, 25, 0.035, 0.94, -21, -0.0001, 0.00015, 1],
    [1.07, 0.025, -42, -0.018, 1.04, 30, 0.00012, -0.0001, 1],
  ])('recovers independently rendered projective motion %j', (...matrix) => {
    const ref = notation(),
      result = registerFrame(ref, warp(ref, matrix));
    expect(result).not.toBeNull();
    for (const point of [
      { x: 80, y: 90 },
      { x: 210, y: 250 },
      { x: 150, y: 180 },
    ]) {
      const actual = project(result!.matrix, point),
        expected = project(matrix, point);
      expect(Math.hypot(actual.x - expected.x, actual.y - expected.y)).toBeLessThan(2);
    }
    expect(result!.inliers).toBeGreaterThanOrEqual(12);
  });
  it('rejects blank, unrelated notation, and ambiguous staff lines', () => {
    const ref = notation();
    expect(registerFrame(ref, blank())).toBeNull();
    expect(registerFrame(ref, notation(9643))).toBeNull();
    for (const seed of [93, 471, 61, 842, 163, 7459, 2137, 19827])
      expect(registerFrame(ref, notation(seed))).toBeNull();
    const staves = blank();
    for (let y = 20; y < 340; y += 5) for (let x = 10; x < 290; x++) ink(staves, x, y);
    expect(registerFrame(staves, warp(staves, [1, 0, 10, 0, 1, 10, 0, 0, 1]))).toBeNull();
  });
  it('reports low sharpness for flat and defocused frames', () => {
    const ref = notation(),
      blur = blank();
    for (let y = 5; y < 355; y++)
      for (let x = 5; x < 295; x++) {
        let sum = 0;
        for (let dy = -5; dy <= 5; dy++)
          for (let dx = -5; dx <= 5; dx++) sum += ref.data[((y + dy) * 300 + x + dx) * 4]!;
        ink(blur, x, y, sum / 121);
      }
    expect(sharpness(blank())).toBe(0);
    expect(sharpness(ref)).toBeGreaterThan(80);
    expect(sharpness(blur)).toBeLessThan(80);
    expect(registerFrame(ref, blur)).toBeNull();
  });
  it('issue 147: a page with music in its top third only is sharp, and tracked', () => {
    const partial = notation(17, 2);
    const defocus = (frame: Frame, radius = 5) => {
      const out = blank();
      for (let y = radius; y < 360 - radius; y++)
        for (let x = radius; x < 300 - radius; x++) {
          let sum = 0;
          for (let dy = -radius; dy <= radius; dy++)
            for (let dx = -radius; dx <= radius; dx++)
              sum += frame.data[((y + dy) * 300 + x + dx) * 4]!;
          ink(out, x, y, sum / (2 * radius + 1) ** 2);
        }
      return out;
    };
    expect(sharpness(partial)).toBeGreaterThan(80);
    // Slightly soft, as a phone's frame is: sharp, as the same softness on a full page is. Over
    // the whole frame it read 62, the blank half pulling it under the floor.
    expect(sharpness(defocus(notation(), 2))).toBeGreaterThan(80);
    expect(sharpness(defocus(partial, 2))).toBeGreaterThan(80);
    expect(sharpness(defocus(partial))).toBeLessThan(80);
    // A full page keeps its reading, so the floor means what it did.
    expect(sharpness(defocus(notation()))).toBeLessThan(80);
    for (const matrix of [
      [1, 0, 24, 0, 1, -18, 0, 0, 1],
      [0.96, -0.03, 18, 0.03, 0.96, 12, 0, 0, 1],
    ]) {
      const result = registerFrame(partial, warp(partial, matrix));
      expect(result).not.toBeNull();
      // Also where the page is blank: the dots there are placed by the same plane.
      for (const point of [
        { x: 80, y: 60 },
        { x: 220, y: 140 },
        { x: 150, y: 300 },
      ]) {
        const actual = project(result!.matrix, point),
          expected = project(matrix, point);
        expect(Math.hypot(actual.x - expected.x, actual.y - expected.y)).toBeLessThan(3);
      }
    }
    // A sliver of music is still too little to place the page by.
    const sliver = blank();
    const one = notation(17, 1);
    for (let y = 20; y < 60; y++)
      for (let x = 100; x < 160; x++)
        sliver.data.set(
          one.data.subarray((y * 300 + x) * 4, (y * 300 + x) * 4 + 4),
          (y * 300 + x) * 4,
        );
    expect(registerFrame(sliver, warp(sliver, [1, 0, 10, 0, 1, 5, 0, 0, 1]))).toBeNull();
  });
  it('requires distributed matches inside the selected page, not its textured surroundings', () => {
    const reference = notation();
    const region = [
      { x: 70, y: 90 },
      { x: 230, y: 90 },
      { x: 230, y: 270 },
      { x: 70, y: 270 },
    ];
    const motion = [1, 0, 22, 0, 1, 24, 0, 0, 1];
    const covered = { ...reference, data: reference.data.slice() };
    for (let y = 90; y <= 270; y++) for (let x = 70; x <= 230; x++) ink(covered, x, y, 245);
    expect(registerFrame(reference, warp(covered, motion))).not.toBeNull();
    expect(registerFrame(reference, warp(covered, motion), region)).toBeNull();
    const result = registerFrame(reference, warp(reference, motion), region);
    expect(result).not.toBeNull();
    expect(result!.inliers).toBeGreaterThanOrEqual(12);
    expect(result!.coverage).toBeGreaterThan(0.18);
  });
  it('a reference prepared once registers every frame exactly as the unprepared one does', () => {
    const reference = notation();
    const region = [
      { x: 20, y: 20 },
      { x: 280, y: 25 },
      { x: 275, y: 340 },
      { x: 25, y: 335 },
    ];
    const covered = { ...reference, data: reference.data.slice() };
    for (let y = 90; y <= 270; y++) for (let x = 70; x <= 230; x++) ink(covered, x, y, 245);
    const currents = [
      warp(reference, identity),
      warp(reference, [1, 0, 72, 0, 1, -62, 0, 0, 1]),
      warp(reference, [0.94, -0.035, 25, 0.035, 0.94, -21, -0.0001, 0.00015, 1]),
      warp(reference, [1.07, 0.025, -42, -0.018, 1.04, 30, 0.00012, -0.0001, 1]),
      warp(covered, [1, 0, 22, 0, 1, 24, 0, 0, 1]),
      blank(),
      notation(9643),
      blank(200, 360),
    ];
    for (const area of [undefined, region]) {
      const prepared = prepareReference(reference, area);
      expect(prepared).toMatchObject({ width: 300, height: 360, trackable: true });
      // The same reference, prepared once, serves every frame; the region travels with it.
      for (const current of currents)
        expect(registerFrame(prepared, current, [{ x: 0, y: 0 }])).toEqual(
          registerFrame(reference, current, area),
        );
    }
    expect(registerFrame(prepareReference(reference, region), currents[1]!)).not.toBeNull();
  });
  it('a prepared reference keeps the floors: blurred, oversized or a bad region never registers', () => {
    const reference = notation();
    const moved = warp(reference, [1, 0, 30, 0, 1, 20, 0, 0, 1]);
    expect(prepareReference(blank()).trackable).toBe(false);
    expect(registerFrame(prepareReference(blank()), moved)).toBeNull();
    const crossed = [
      { x: 20, y: 20 },
      { x: 280, y: 340 },
      { x: 280, y: 20 },
      { x: 20, y: 340 },
    ];
    expect(prepareReference(reference, crossed)).toMatchObject({ trackable: false, features: [] });
    expect(registerFrame(prepareReference(reference, crossed), moved)).toBeNull();
    const large = blank(400, 300);
    expect(prepareReference(large).trackable).toBe(false);
  });
});
describe('score page fusion', () => {
  it('reconstructs an independently photographed trapezoidal A4 page into a metric rectangle', async () => {
    const score = notation(),
      source = blank(300, 424, 255),
      aspect = 210 / 297;
    for (let y = 0; y < 424; y++)
      for (let x = 0; x < 300; x++) {
        const value = score.data[(Math.floor((y / 424) * 360) * 300 + x) * 4]!;
        if (value < 245) ink(source, x, y, value);
      }
    const poses = [
      [0.25, -0.22, -aspect / 2, -0.5],
      [0.22, -0.19, -aspect / 2 + 0.08, -0.46],
      [0.28, -0.24, -aspect / 2 - 0.08, -0.54],
      [0.23, -0.26, -aspect / 2, -0.42],
      [0.27, -0.2, -aspect / 2, -0.58],
    ];
    const planes = poses.map((p) => cameraPlane(p[0]!, p[1]!, p[2]!, p[3]!));
    const referenceInverse = inverseMatrix(planes[0]!);
    const captures = planes.map((plane, i) => {
      const matrix = i === 0 ? identity : multiplyMatrix(plane, referenceInverse);
      const denominator = matrix[8]!;
      return {
        frame: warp(
          source,
          multiplyMatrix(plane, [1 / 299, 0, 0, 0, 1 / 423, 0, 0, 0, 1]),
          1000,
          1000,
        ),
        matrix: matrix.map((v) => v / denominator),
      };
    });
    const pageCorners = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ].map(([x, y]) => oraclePoint(planes[0]!, x!, y!));
    const output = await mergeCaptures(captures, pageCorners);
    expect(Math.abs((output.width - 1) / (output.height - 1) / aspect - 1)).toBeLessThan(0.01);
    let maxStaffError = 0;
    for (let system = 0; system < 5; system++)
      for (let line = 0; line < 5; line++) {
        const sy = 25 + system * 65 + line * 5;
        const sourceCenter =
          (Math.ceil((sy * 424) / 360) + Math.ceil(((sy + 1) * 424) / 360) - 1) / 2;
        const expected = (sourceCenter / 423) * (output.height - 1);
        let bestY = 0,
          bestDark = -Infinity;
        for (let y = Math.round(expected) - 3; y <= Math.round(expected) + 3; y++) {
          let darkness = 0;
          for (let x = Math.round(output.width * 0.08); x < output.width * 0.92; x++)
            darkness += 255 - output.data[(y * output.width + x) * 4]!;
          if (darkness > bestDark) {
            bestDark = darkness;
            bestY = y;
          }
        }
        maxStaffError = Math.max(maxStaffError, Math.abs(bestY - expected));
      }
    expect(maxStaffError).toBeLessThan(1);
    let stems = 0,
      maxStemError = 0;
    for (let y = 20; y < 404; y += 13)
      for (let x = 20; x < 280; x++) {
        const at = (px: number, py: number) => source.data[(py * 300 + px) * 4]!;
        if (
          at(x, y) < 30 &&
          at(x, y - 2) < 30 &&
          at(x, y + 2) < 30 &&
          at(x - 2, y) > 200 &&
          at(x + 2, y) > 200
        ) {
          const expectedX = (x / 299) * (output.width - 1),
            oy = Math.round((y / 423) * (output.height - 1));
          let bestX = 0,
            bestDark = -Infinity;
          for (let ox = Math.round(expectedX) - 3; ox <= Math.round(expectedX) + 3; ox++) {
            let darkness = 0;
            for (let dy = -1; dy <= 1; dy++)
              darkness += 255 - output.data[((oy + dy) * output.width + ox) * 4]!;
            if (darkness > bestDark) {
              bestDark = darkness;
              bestX = ox;
            }
          }
          maxStemError = Math.max(maxStemError, Math.abs(bestX - expectedX));
          stems++;
        }
      }
    expect(stems).toBeGreaterThan(15);
    expect(maxStemError).toBeLessThan(1);
  }, 30000);
  it('retains phase-sensitive single-row staff ink during full-resolution refinement', async () => {
    const source = notation(),
      frame = blank(900, 1080, 255);
    for (let y = 0; y < 1080; y += 3)
      for (let x = 0; x < 900; x++) {
        const value = source.data[(Math.floor(y / 3) * 300 + Math.floor(x / 3)) * 4]!;
        if (value < 245) ink(frame, x, y, value);
      }
    const reconstruction = await reconstructPage(
      Array.from({ length: 5 }, () => ({ frame, matrix: identity })),
      [
        { x: 0, y: 0 },
        { x: 899, y: 0 },
        { x: 899, y: 1079 },
        { x: 0, y: 1079 },
      ],
    );
    const output = reconstruction.frame;
    expect(output.width).toBe(900);
    expect(output.height).toBe(1080);
    let changed = 0;
    for (let i = 0; i < frame.data.length; i++) if (output.data[i] !== frame.data[i]) changed++;
    expect(changed).toBe(0);
  }, 30000);
  it('bilinearly samples fractional page coordinates while retaining integer samples', async () => {
    const frame = blank(120, 100);
    for (let y = 0; y < 100; y++) for (let x = 0; x < 120; x++) ink(frame, x, y, x + y);
    for (const offset of [0, 0.25]) {
      const { frame: output } = await reconstructPage(
        [{ frame, matrix: identity }],
        [
          { x: 10 + offset, y: 8 + offset * 1.6 },
          { x: 109 + offset, y: 8 + offset * 1.6 },
          { x: 109 + offset, y: 77 + offset * 1.6 },
          { x: 10 + offset, y: 77 + offset * 1.6 },
        ],
      );
      expect(output.data[(15 * output.width + 20) * 4]).toBe(Math.round(53 + offset * 2.6));
    }
  });
  it('does not paint an isolated dark shadow or a misaligned note onto white paper', async () => {
    const ref = notation();
    for (let i = 0; i < ref.data.length; i += 4)
      if (ref.data[i] === 245) ref.data.set([255, 255, 255, 255], i);
    const moved = { ...ref, data: ref.data.slice() };
    for (let y = 90; y < 110; y++) for (let x = 80; x < 110; x++) ink(moved, x, y, 70);
    const captures = [ref, moved, moved, ref, ref].map((frame) => ({ frame, matrix: identity }));
    const result = await mergeCaptures(captures, corners);
    // Existing ink may average a slightly darker agreeing measurement. White
    // paper and the exact musical-mark mask must remain unchanged everywhere.
    for (let i = 0; i < ref.data.length; i += 4) {
      if (ref.data[i] === 255) expect(result.data[i]).toBe(255);
      expect(result.data[i]! < 120).toBe(ref.data[i]! < 120);
    }
  });
  it('rectifies perspective and permits partial moved views', async () => {
    const ref = notation();
    const moves = [
      identity,
      [1, 0, 60, 0, 1, 0, 0, 0, 1],
      [1, 0, -60, 0, 1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1, 60, 0, 0, 1],
      [1, 0, 0, 0, 1, -60, 0, 0, 1],
    ];
    const result = await mergeCaptures(
      moves.map((matrix) => ({ frame: warp(ref, matrix), matrix })),
      corners,
    );
    expect(result.width).toBe(300);
    expect(result.height).toBe(360);
    expect(result.data.some((v, i) => i % 4 === 0 && v < 60)).toBe(true);
  });
  it('rejects invalid corners, dimension mismatches, missing overlap and wrong view count', async () => {
    const frame = notation(),
      good = Array.from({ length: 5 }, () => ({ frame, matrix: identity }));
    await expect(
      mergeCaptures(good, [corners[0]!, corners[2]!, corners[1]!, corners[3]!]),
    ).rejects.toThrow();
    await expect(mergeCaptures(good.slice(1), corners)).rejects.toThrow();
    await expect(
      mergeCaptures([...good.slice(1), { frame: blank(100, 100), matrix: identity }], corners),
    ).rejects.toThrow();
    await expect(
      mergeCaptures([...good.slice(1), { frame, matrix: [1, 0, 500, 0, 1, 0, 0, 0, 1] }], corners),
    ).rejects.toThrow();
    await expect(
      mergeCaptures(
        [...good.slice(1), { frame, matrix: [0, 0, 120, 0, 0, 120, 0, 0, 1] }],
        corners,
      ),
    ).rejects.toThrow();
    await expect(
      mergeCaptures([...good.slice(1), { frame, matrix: [-1, 0, 299, 0, 1, 0, 0, 0, 1] }], corners),
    ).rejects.toThrow();
  });
  it('limits output and yields so cancellation can interrupt processing', async () => {
    const frame = blank(2600, 1900),
      captures = Array.from({ length: 5 }, () => ({ frame, matrix: identity }));
    const largeCorners = [
      { x: 0, y: 0 },
      { x: 2599, y: 0 },
      { x: 2599, y: 1899 },
      { x: 0, y: 1899 },
    ];
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 0);
    await expect(mergeCaptures(captures, largeCorners, controller.signal)).rejects.toThrow(
      /abort/i,
    );
    controller.abort();
    await expect(mergeCaptures(captures, largeCorners, controller.signal)).rejects.toThrow(
      /abort/i,
    );
  });
});

describe('issue 147: the printed part of a page', () => {
  const page = [
    { x: 5, y: 5 },
    { x: 295, y: 5 },
    { x: 295, y: 355 },
    { x: 5, y: 355 },
  ];
  it('boxes the music and leaves out blank paper', () => {
    const box = contentBounds(notation(17, 2), page)!;
    expect(box.top).toBeLessThan(30);
    expect(box.bottom).toBeGreaterThan(120);
    expect(box.bottom).toBeLessThan(200);
    expect(box.right - box.left).toBeGreaterThan(220);
    expect(contentBounds(blank(), page)).toBeUndefined();
  });
  it('does not count the page edge against a dark table as content', () => {
    const frame = blank(300, 360, 40);
    for (let y = 30; y < 330; y++) for (let x = 30; x < 270; x++) ink(frame, x, y, 240);
    const edge = [
      { x: 30, y: 30 },
      { x: 270, y: 30 },
      { x: 270, y: 330 },
      { x: 30, y: 330 },
    ];
    expect(contentBounds(frame, edge)).toBeUndefined();
  });
});
