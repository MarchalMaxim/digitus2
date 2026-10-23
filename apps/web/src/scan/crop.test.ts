import { describe, expect, it } from 'vitest';
import type { StaffGeometry } from './camera/staffGeometry.js';
import {
  CROP_HALF_HEIGHT_SPACES,
  CROP_HALF_WIDTH_SPACES,
  cropRect,
  fallbackSpace,
  FRAME_SPACES,
  staffSpaceFrom,
} from './crop.js';

const geometry = (spacings: number[][]) =>
  ({
    staves: spacings.map((sourceSpacings) => ({ sourceSpacings })),
  }) as unknown as StaffGeometry;

describe('the photo crop around a note (issue 161)', () => {
  it('is centred on the note and sized in staff spaces', () => {
    expect(cropRect({ x: 100, y: 50 }, 10)).toEqual({
      x: 100 - CROP_HALF_WIDTH_SPACES * 10,
      y: 50 - CROP_HALF_HEIGHT_SPACES * 10,
      width: 2 * CROP_HALF_WIDTH_SPACES * 10,
      height: 2 * CROP_HALF_HEIGHT_SPACES * 10,
    });
    expect(CROP_HALF_WIDTH_SPACES).toBe(2 * CROP_HALF_HEIGHT_SPACES);
    expect(FRAME_SPACES).toBeLessThan(CROP_HALF_HEIGHT_SPACES * 2);
  });

  it('takes the median spacing of every staff, back in the page photo pixels', () => {
    expect(staffSpaceFrom(geometry([[8, 8, 8], [10, 12], [20]]), 0.5)).toBe(20);
    expect(staffSpaceFrom(geometry([[8, 10], [12]]), 1)).toBe(10);
  });

  it('has no spacing without a geometry or without staves', () => {
    expect(staffSpaceFrom(null, 1)).toBeUndefined();
    expect(staffSpaceFrom(geometry([]), 1)).toBeUndefined();
    expect(staffSpaceFrom(geometry([[]]), 1)).toBeUndefined();
  });

  it('falls back to a staff space of a page 120th of the width', () => {
    expect(fallbackSpace(2400)).toBe(20);
  });
});
