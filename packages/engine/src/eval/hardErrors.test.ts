import { describe, expect, it } from 'vitest';
import { hardErrors } from './hardErrors.js';

describe('hardErrors', () => {
  it('counts mismatches only on unanimous notes', () => {
    const r = hardErrors(
      [1, 2, 3, 4],
      [
        [1, 2, 3, 5],
        [1, 2, 4, 5],
      ],
    );
    expect(r.unanimous).toBe(3); // notes 0, 1, 3
    expect(r.hardErrors).toBe(1); // note 3: all say 5, we say 4
    expect(r.rate).toBeCloseTo(1 / 3);
  });
  it('is zero with a single annotator or no unanimous notes', () => {
    expect(hardErrors([1, 2], [[1, 3]]).unanimous).toBe(0);
    expect(
      hardErrors(
        [1, 2],
        [
          [1, 3],
          [2, 2],
        ],
      ).rate,
    ).toBe(0);
  });
});
