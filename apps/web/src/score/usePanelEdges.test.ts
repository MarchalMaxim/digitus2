import { describe, expect, it } from 'vitest';
import { EDGE_CLEARANCE, hiddenEdges, keepScroll } from './usePanelEdges.js';

describe('the edges of a scroller that cut off content', () => {
  it('shows nothing cut while the content fits', () => {
    expect(hiddenEdges(0, 300, 300)).toEqual({ above: false, below: false });
  });

  it('cuts the bottom while it rests at its top', () => {
    expect(hiddenEdges(0, 392, 362)).toEqual({ above: false, below: true });
  });

  it('cuts the top once scrolled to the bottom', () => {
    expect(hiddenEdges(30, 392, 362)).toEqual({ above: true, below: false });
  });

  it('cuts both while scrolled between', () => {
    expect(hiddenEdges(12, 392, 362)).toEqual({ above: true, below: true });
  });

  it('ignores a pixel of rounding', () => {
    expect(hiddenEdges(0.5, 362.5, 362)).toEqual({ above: false, below: false });
  });
});

// The panel keeps its place when its content grows (issue 244): at its top the head stays and
// the control the reader used stays whole in the box; scrolled, that control stays where it was.
describe('the scroll the panel keeps when its content grows', () => {
  // The used control is 44 high; offsets run from the box's top edge, which is 360 high.
  const used = (before: number, after: number) => ({ before, after, height: 44 });

  it('is the scroll it had when nothing moves', () => {
    expect(keepScroll(0, null, 360)).toBe(0);
    expect(keepScroll(80, null, 360)).toBe(80);
    expect(keepScroll(80, used(120, 120), 360)).toBe(80);
  });

  it('keeps the head at the top while the used control stays whole in the box', () => {
    // A row arrives above Hands: it drops one row and the panel still shows Practice mode first.
    expect(keepScroll(0, used(100, 152), 360)).toBe(0);
  });

  it('brings the used control back by as much as it has left the box at the top', () => {
    // Dropped 52 px; its bottom is now 20 px below the box: scroll those 20 px and the hairline.
    expect(keepScroll(0, used(284, 336), 360)).toBe(20 + EDGE_CLEARANCE);
  });

  it('keeps the used control clear of the lower hairline', () => {
    // Its bottom stands on the box's edge: the hairline would be drawn over it.
    expect(keepScroll(0, used(272, 272), 316)).toBe(EDGE_CLEARANCE);
  });

  it('moves the panel when the used control grew and its top stayed', () => {
    // A row arrived inside the control: its top is where it was, its bottom is out of the box.
    expect(keepScroll(0, { before: 300, after: 300, height: 96 }, 360)).toBe(36 + EDGE_CLEARANCE);
  });

  it('never hides the top of a used control taller than the box', () => {
    expect(keepScroll(0, { before: 40, after: 40, height: 500 }, 360)).toBe(40);
  });

  it('keeps the used control where it was when the panel is scrolled', () => {
    expect(keepScroll(80, used(120, 172), 360)).toBe(132);
    expect(keepScroll(80, used(120, 68), 360)).toBe(28);
  });

  it('never scrolls above the top', () => {
    expect(keepScroll(20, used(50, 0), 360)).toBe(0);
  });

  it('ignores a pixel of rounding', () => {
    expect(keepScroll(80, used(120, 120.6), 360)).toBe(80);
  });
});
