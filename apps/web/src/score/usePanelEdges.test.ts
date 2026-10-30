import { describe, expect, it } from 'vitest';
import { hiddenEdges } from './usePanelEdges.js';

describe('the edges of a column-reverse scroller that cut off content', () => {
  it('shows nothing cut while the content fits', () => {
    expect(hiddenEdges(0, 300, 300)).toEqual({ above: false, below: false });
  });

  it('cuts the top while it rests at its bottom origin, by Play', () => {
    expect(hiddenEdges(0, 392, 362)).toEqual({ above: true, below: false });
  });

  it('cuts the bottom once scrolled to the top', () => {
    expect(hiddenEdges(-30, 392, 362)).toEqual({ above: false, below: true });
  });

  it('cuts both while scrolled between', () => {
    expect(hiddenEdges(-12, 392, 362)).toEqual({ above: true, below: true });
  });

  it('ignores a pixel of rounding', () => {
    expect(hiddenEdges(-0.5, 362.5, 362)).toEqual({ above: false, below: false });
  });
});
