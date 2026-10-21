import { describe, expect, it } from 'vitest';
import { analyzeStaffGeometry, dewarpScore, sourceYAt } from './staffGeometry';
import type { Frame } from './vision';

function score(bow: number, onlySlurs = false): Frame {
  const width = 640,
    height = 800;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const shade = Math.round(225 - 45 * (x / width) ** 2);
      const curve = bow * ((x / width - 0.6) ** 2 - 0.12);
      let ink = false;
      for (const center of [100, 230, 400, 550, 690]) {
        if (x < (center === 100 ? 95 : 35) || x > 610) continue;
        for (let line = -2; line <= 2; line++)
          if (!onlySlurs && Math.abs(y - center - line * 8 - curve) < 0.8) ink = true;
        // Notes and large slurs must travel with the paper, not guide the mesh.
        if (Math.abs(y - center + 30 + 30 * Math.sin(x / 160) - curve) < 0.9) ink = true;
        if (x % 63 < 7 && Math.abs(y - center - 5 - curve) < 4) ink = true;
      }
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = ink ? 25 : shade;
    }
  return { width, height, data };
}

describe('staff guided rectification', () => {
  it('does not mistake sparse single-row flat notation for paper curvature', async () => {
    const width = 900,
      height = 1080;
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    for (let y = 0; y < height; y += 3)
      for (let x = 40; x < 860; x++) {
        let ink = false;
        for (const center of [120, 300, 510, 710, 930]) {
          for (let line = -2; line <= 2; line++) if (y === center + line * 15) ink = true;
          if (x % 90 < 18 && Math.abs(y - center - 10) < 20) ink = true;
        }
        if (ink) {
          const i = (y * width + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
    const frame = { width, height, data },
      result = await dewarpScore(frame);
    expect(result.applied).toBe(false);
    expect(result.frame).toBe(frame);
  });

  it('reconnects a staff interrupted by a competing hairpin without extrapolating a false tail', () => {
    const frame = score(95);
    for (let x = 300; x < 450; x++)
      for (const offset of [-24, -16, -8, 0, 8]) {
        const y = Math.round(690 + offset - (x - 300) * 0.3);
        for (let dy = -1; dy <= 1; dy++) {
          const i = ((y + dy) * frame.width + x) * 4;
          frame.data[i] = frame.data[i + 1] = frame.data[i + 2] = 0;
        }
      }
    const geometry = analyzeStaffGeometry(frame)!;
    expect(geometry.staves.length).toBe(5);
    const staff = geometry.staves[geometry.staves.length - 1]!;
    const actual =
      sourceYAt(geometry, 580, staff.targetCenter) - sourceYAt(geometry, 230, staff.targetCenter);
    const expected = 95 * ((580 / 640 - 0.6) ** 2 - (230 / 640 - 0.6) ** 2);
    expect(Math.abs(actual - expected)).toBeLessThan(3);
  });

  it('finds five-line staffs and recovers an unknown curved paper displacement', () => {
    const frame = score(170),
      geometry = analyzeStaffGeometry(frame);
    expect(geometry).not.toBeNull();
    expect(geometry!.staves.length).toBe(5);
    for (const staff of geometry!.staves)
      for (const x of [110, 230, 400, 580]) {
        const actual = sourceYAt(geometry!, x, staff.targetCenter);
        const expectedChange = 170 * ((x / 640 - 0.6) ** 2 - (400 / 640 - 0.6) ** 2);
        expect(
          Math.abs(actual - sourceYAt(geometry!, 400, staff.targetCenter) - expectedChange),
        ).toBeLessThan(2.8);
      }
  });

  it('keeps the inverse map ordered everywhere, including margins and between systems', () => {
    const geometry = analyzeStaffGeometry(score(170))!;
    for (let x = 0; x < 640; x += 13) {
      let previous = -1;
      for (let y = 0; y < 800; y++) {
        const source = sourceYAt(geometry, x, y);
        expect(source).toBeGreaterThan(previous);
        expect(source).toBeGreaterThanOrEqual(0);
        expect(source).toBeLessThanOrEqual(799);
        previous = source;
      }
    }
  });

  it('ignores a short inset staff and retains its notation in the same ordered mesh', () => {
    const frame = score(170);
    for (let x = 420; x < 605; x++)
      for (let line = -2; line <= 2; line++) {
        const y = Math.round(315 + line * 6 + 170 * ((x / 640 - 0.6) ** 2 - 0.12));
        const index = (y * frame.width + x) * 4;
        frame.data[index] = frame.data[index + 1] = frame.data[index + 2] = 0;
      }
    const geometry = analyzeStaffGeometry(frame)!;
    expect(geometry.staves.length).toBe(5);
    expect(sourceYAt(geometry, 500, 315)).toBeGreaterThan(sourceYAt(geometry, 500, 314));
  });

  it('rejects malformed frames and blank or shadow-only paper', () => {
    expect(
      analyzeStaffGeometry({ width: 640, height: 800, data: new Uint8ClampedArray(1) }),
    ).toBeNull();
    const blank = score(0);
    for (let y = 0; y < blank.height; y++)
      for (let x = 0; x < blank.width; x++) {
        const i = (y * blank.width + x) * 4,
          shade = 90 + (120 * x) / blank.width;
        blank.data[i] = blank.data[i + 1] = blank.data[i + 2] = shade;
      }
    expect(analyzeStaffGeometry(blank)).toBeNull();
  });

  it('requires repeated staff evidence and leaves an already flat score byte-identical', async () => {
    expect(analyzeStaffGeometry(score(170, true))).toBeNull();
    const flat = score(0);
    const result = await dewarpScore(flat);
    expect(result.applied).toBe(false);
    expect(result.frame).toBe(flat);
  });

  it('resamples all RGBA channels and honours cancellation', async () => {
    const frame = score(170),
      result = await dewarpScore(frame);
    expect(result.applied).toBe(true);
    expect(result.frame.width).toBe(frame.width);
    expect(result.frame.data.length).toBe(frame.data.length);
    const abort = new AbortController();
    abort.abort();
    await expect(dewarpScore(frame, abort.signal)).rejects.toThrow();
  });
});
