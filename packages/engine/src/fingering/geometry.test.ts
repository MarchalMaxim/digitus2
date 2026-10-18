import { describe, expect, it } from 'vitest';
import { isBlack, mirrorPitch, whiteColumn, x14 } from './geometry.js';

describe('geometry', () => {
  it('mirrors about D4 and preserves key colour', () => {
    expect(mirrorPitch(62)).toBe(62);
    expect(mirrorPitch(60)).toBe(64);
    expect(mirrorPitch(61)).toBe(63);
    for (let p = 21; p <= 108; p++) expect(isBlack(mirrorPitch(p))).toBe(isBlack(p));
  });
  it('computes white-key columns and 14-unit coordinates', () => {
    expect(whiteColumn(60)).toBe(35);
    expect(whiteColumn(61)).toBe(35);
    expect(whiteColumn(62)).toBe(36);
    expect(whiteColumn(72) - whiteColumn(60)).toBe(7);
    expect(x14(60)).toBe(70);
    expect(x14(64) - x14(60)).toBe(4);
    expect(x14(65) - x14(64)).toBe(2);
  });
  it('counts white keys from C: G is the fifth white key, and B sits 12 units above C', () => {
    // Octave of C4 (60): C D E F G A B are white columns 0..6 above C; the sharps share their natural's column.
    const cols = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
    for (let i = 0; i < 12; i++) expect(whiteColumn(60 + i) - whiteColumn(60)).toBe(cols[i]);
    expect(x14(71) - x14(60)).toBe(12);
  });
});
