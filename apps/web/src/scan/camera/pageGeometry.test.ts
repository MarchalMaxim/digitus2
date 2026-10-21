import { describe, expect, it } from 'vitest';
import { estimatePageGeometry } from './pageGeometry';

type Matrix = number[];
const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
function multiply(a: Matrix, b: Matrix): Matrix {
  return Array.from({ length: 9 }, (_, i) => {
    const row = Math.floor(i / 3),
      col = i % 3;
    return a[row * 3]! * b[col]! + a[row * 3 + 1]! * b[col + 3]! + a[row * 3 + 2]! * b[col + 6]!;
  });
}
function inverse(m: Matrix): Matrix {
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
  const adj = [
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
  const determinant = a * adj[0]! + b * adj[3]! + c * adj[6]!;
  return adj.map((v) => v / determinant);
}
function point(h: Matrix, x: number, y: number) {
  const z = h[6]! * x + h[7]! * y + h[8]!;
  return { x: (h[0]! * x + h[1]! * y + h[2]!) / z, y: (h[3]! * x + h[4]! * y + h[5]!) / z };
}
// Independent pinhole camera oracle, projecting a physical rectangle.
function camera(aspect: number, ax: number, ay: number, tx: number, ty: number, tz = 2): Matrix {
  const rx = [1, 0, 0, 0, Math.cos(ax), -Math.sin(ax), 0, Math.sin(ax), Math.cos(ax)];
  const ry = [Math.cos(ay), 0, Math.sin(ay), 0, 1, 0, -Math.sin(ay), 0, Math.cos(ay)];
  const rotation = multiply(ry, rx);
  const plane = [
    rotation[0]! * aspect,
    rotation[1]!,
    tx,
    rotation[3]! * aspect,
    rotation[4]!,
    ty,
    rotation[6]! * aspect,
    rotation[7]!,
    tz,
  ];
  return multiply([1400, 0, 1000, 0, 1400, 800, 0, 0, 1], plane);
}
function fixture(aspect: number, frontal = false, distance = 2) {
  const poses = frontal
    ? [
        [0, 0, -aspect / 2, -0.5],
        [0, 0, -aspect / 2 + 0.15, -0.5],
        [0, 0, -aspect / 2 - 0.15, -0.5],
        [0, 0, -aspect / 2, -0.35],
        [0, 0, -aspect / 2, -0.65],
      ]
    : [
        [0.35, -0.3, -aspect / 2, -0.5],
        [0.29, -0.25, -aspect / 2 + 0.13, -0.44],
        [0.4, -0.32, -aspect / 2 - 0.11, -0.53],
        [0.31, -0.38, -aspect / 2, -0.38],
        [0.38, -0.27, -aspect / 2, -0.63],
      ];
  const hs = poses.map((p) => camera(aspect, p[0]!, p[1]!, p[2]!, p[3]!, distance));
  const corners = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ].map(([x, y]) => point(hs[0]!, x!, y!));
  const captures = hs.map((h) => ({
    frame: { width: 2000, height: 1600 },
    matrix: multiply(h, inverse(hs[0]!)),
  }));
  return { corners, captures };
}

describe('metric score page geometry', () => {
  it.each([210 / 297, 8.5 / 11, 1.5])(
    'recovers physical page aspect %f under perspective',
    (aspect) => {
      const { corners, captures } = fixture(aspect, false, 1.2);
      const result = estimatePageGeometry(corners, captures);
      expect(result.method).toBe('metric');
      expect(Math.abs(result.aspectRatio / aspect - 1)).toBeLessThan(0.01);
      expect(Math.abs(result.focalLength! / 1400 - 1)).toBeLessThan(0.01);
      expect(Math.abs((result.width - 1) / (result.height - 1) / aspect - 1)).toBeLessThan(0.01);
    },
  );
  it('declares an approximation when corner uncertainty materially changes a small page aspect', () => {
    const { corners, captures } = fixture(210 / 297);
    expect(estimatePageGeometry(corners, captures).method).toBe('approximate');
  });
  it('uses a declared stable approximation when parallel frontal views cannot calibrate focal length', () => {
    const { corners, captures } = fixture(210 / 297, true);
    const result = estimatePageGeometry(corners, captures);
    expect(result.method).toBe('approximate');
    expect(result.focalLength).toBeNull();
    expect(Math.abs(result.aspectRatio / (210 / 297) - 1)).toBeLessThan(0.001);
  });
  it('does not mistake arbitrary affine shear for metric camera calibration', () => {
    const corners = [
      { x: 100, y: 100 },
      { x: 900, y: 100 },
      { x: 1050, y: 1100 },
      { x: 250, y: 1100 },
    ];
    const captures = Array.from({ length: 5 }, () => ({
      frame: { width: 1400, height: 1400 },
      matrix: identity,
    }));
    expect(estimatePageGeometry(corners, captures).method).toBe('approximate');
  });
  it('is robust to one bad view and modest corner localization noise', () => {
    const { corners, captures } = fixture(210 / 297, false, 1.2);
    captures[4]!.matrix = [1, 0, 0, 0, 1, 0, 0.0004, 0.0003, 1];
    const noisy = corners.map((p, i) => ({
      x: p.x + [0.2, -0.2, 0.1, -0.1][i]!,
      y: p.y + [-0.1, 0.1, -0.2, 0.2][i]!,
    }));
    const result = estimatePageGeometry(noisy, captures);
    expect(result.method).toBe('metric');
    expect(Math.abs(result.aspectRatio / (210 / 297) - 1)).toBeLessThan(0.02);
  });
  it.each(
    [
      {
        ax: 0.02,
        ay: 0.3,
        noisy: [
          { x: 627.6899946054393, y: 255.84028167333645 },
          { x: 1428.6241232132993, y: 158.6660774129062 },
          { x: 1434.9646544472394, y: 1435.3361574112803 },
          { x: 639.6308682102263, y: 1330.5244561061486 },
        ],
      },
      {
        ax: 0.06,
        ay: 0.5,
        noisy: [
          { x: 658.1217464175675, y: 276.5299393620594 },
          { x: 1408.5313613289868, y: 107.31234175300075 },
          { x: 1433.796541964732, y: 1463.8383609227274 },
          { x: 699.4338266955167, y: 1297.4731551748812 },
        ],
      },
      {
        ax: 0.08,
        ay: 0.7,
        noisy: [
          { x: 699.7495020765125, y: 297.3403214451641 },
          { x: 1359.7577934200908, y: 62.163387356832274 },
          { x: 1417.1834348075897, y: 1498.4722622429406 },
          { x: 761.3310769743208, y: 1275.343975412138 },
        ],
      },
    ].flatMap((configuration) =>
      [0.5, 1, 2].flatMap((scale) =>
        [false, true].map((turn) => ({ ...configuration, scale, turn })),
      ),
    ),
  )(
    'rejects shared corner uncertainty at tilt $ax/$ay, scale $scale, turned $turn',
    ({ ax, ay, noisy, scale, turn }) => {
      const aspect = 210 / 297;
      // Same near-single-axis tilt in every view: translation does not add an
      // independent constraint on the shared, manually localized page corners.
      const rotation = multiply(
        [Math.cos(ay), 0, Math.sin(ay), 0, 1, 0, -Math.sin(ay), 0, Math.cos(ay)],
        [1, 0, 0, 0, Math.cos(ax), -Math.sin(ax), 0, Math.sin(ax), Math.cos(ax)],
      );
      const hs = [
        [0, 0],
        [0.15, 0.22],
        [-0.15, 0.22],
        [-0.15, -0.22],
        [0.15, -0.22],
      ].map(([dx, dy]) =>
        multiply(
          [1400, 0, 1000, 0, 1400, 800, 0, 0, 1],
          [
            rotation[0]! * aspect,
            rotation[1]!,
            (-rotation[0]! * aspect) / 2 - rotation[1]! / 2 + dx!,
            rotation[3]! * aspect,
            rotation[4]!,
            (-rotation[3]! * aspect) / 2 - rotation[4]! / 2 + dy!,
            rotation[6]! * aspect,
            rotation[7]!,
            1.2 - (rotation[6]! * aspect) / 2 - rotation[7]! / 2,
          ],
        ),
      );
      const scaling = turn
        ? [0, -scale, 1600 * scale, scale, 0, 0, 0, 0, 1]
        : [scale, 0, 0, 0, scale, 0, 0, 0, 1];
      const captures = hs.map((h) => ({
        frame: { width: (turn ? 1600 : 2000) * scale, height: (turn ? 2000 : 1600) * scale },
        matrix: multiply(multiply(scaling, multiply(h, inverse(hs[0]!))), inverse(scaling)),
      }));
      const corners = noisy.map((p) => point(scaling, p.x, p.y));
      // Even noiseless corners cannot establish that the weak perspective
      // coordinate is reliable within the manual localization error budget.
      const exactCorners = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ].map(([x, y]) => {
        const p = point(hs[0]!, x!, y!);
        return point(scaling, p.x, p.y);
      });
      const result = estimatePageGeometry(corners, captures);
      expect(result.method).toBe('approximate');
      expect(result.focalLength).toBeNull();
      expect(estimatePageGeometry(exactCorners, captures).method).toBe('approximate');
    },
  );
  it('rejects crossed, concave, outside, nonfinite, and degenerate page boundaries', () => {
    const { corners, captures } = fixture(210 / 297);
    for (const bad of [
      [corners[0]!, corners[2]!, corners[1]!, corners[3]!],
      [corners[0]!, corners[1]!, { x: 650, y: 550 }, corners[3]!],
      [{ x: -1, y: 0 }, corners[1]!, corners[2]!, corners[3]!],
      [{ x: NaN, y: 0 }, corners[1]!, corners[2]!, corners[3]!],
      Array.from({ length: 4 }, () => corners[0]!),
    ])
      expect(() => estimatePageGeometry(bad, captures)).toThrow(/page/i);
  });
});
