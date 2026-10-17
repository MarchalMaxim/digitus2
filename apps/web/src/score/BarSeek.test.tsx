import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BarSeek, type BarSeekHandle } from './BarSeek.js';

const SVG = 'http://www.w3.org/2000/svg';

function rect(left: number, top: number, right: number, bottom: number): DOMRect {
  return {
    left,
    top,
    right,
    bottom,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    toJSON: () => ({}),
  };
}

/**
 * A rendered score: `bars` bars side by side, each 100 px wide, whose staff lines lie 40 to 80 px
 * down. BarSeek pads a bar by 0.75 staff heights (30 px), so bar n answers x in [100n, 100n + 100)
 * and y in [10, 110). `reads` counts how often the layout is asked.
 */
function scoreHost(bars: number): { host: Element; reads: () => number } {
  let count = 0;
  const host = document.createElement('div');
  host.getBoundingClientRect = () => rect(0, 0, bars * 100, 200);
  for (let i = 0; i < bars; i++) {
    const measure = document.createElementNS(SVG, 'g');
    measure.setAttribute('class', 'measure');
    const staff = document.createElementNS(SVG, 'g');
    staff.setAttribute('class', 'staff');
    const line = document.createElementNS(SVG, 'path');
    line.getBoundingClientRect = () => {
      count++;
      return rect(i * 100, 40, (i + 1) * 100, 80);
    };
    staff.append(line);
    measure.append(staff);
    host.append(measure);
  }
  return { host, reads: () => count };
}

function setup(over: Partial<Parameters<typeof BarSeek>[0]> = {}) {
  const { host, reads } = scoreHost(3);
  const onSeek = vi.fn<(bar: number) => void>();
  const handle = createRef<BarSeekHandle>();
  const props = { host, layoutKey: 'w900', canSeek: () => true, onSeek, handle, ...over };
  const view = render(
    <BarSeek {...props}>
      <p>the pages</p>
    </BarSeek>,
  );
  const stage = view.container.querySelector('.score-stage') as HTMLElement;
  const again = (next: Partial<typeof props>) =>
    view.rerender(
      <BarSeek {...props} {...next}>
        <p>the pages</p>
      </BarSeek>,
    );
  return { ...view, stage, onSeek, handle, reads, again };
}

const at = (x: number, y: number) => ({ clientX: x, clientY: y });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('BarSeek', () => {
  it('seeks to the bar under a plain click, leaves a footprint on it, and keeps the note burst out', () => {
    const { stage, onSeek, container } = setup();
    // The click is handled, so the note burst (which listens for clicks on nothing) stays quiet.
    expect(fireEvent.click(stage, at(150, 60))).toBe(false);
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(1);
    const print = container.querySelector('.bar-footprint') as HTMLElement;
    expect(print).toHaveStyle({ left: '100px', top: '10px', width: '100px', height: '100px' });
    expect(print).toHaveAttribute('aria-hidden', 'true');
  });

  it('answers a click in each bar with that bar', () => {
    const { stage, onSeek } = setup();
    fireEvent.click(stage, at(5, 12)); // the first corner of bar 0
    fireEvent.click(stage, at(299, 109)); // the last one of bar 2
    expect(onSeek.mock.calls).toEqual([[0], [2]]);
  });

  it('leaves a click outside the bars, or in a bar it may not seek to, to the page', () => {
    const { stage, onSeek, container } = setup({ canSeek: (bar) => bar !== 2 });
    expect(fireEvent.click(stage, at(150, 150))).toBe(true); // under the staves: no bar there
    expect(fireEvent.click(stage, at(350, 60))).toBe(true); // right of the last bar
    expect(fireEvent.click(stage, at(250, 60))).toBe(true); // bar 2: outside the loop, say
    expect(onSeek).not.toHaveBeenCalled();
    expect(container.querySelector('.bar-footprint')).toBeNull();
  });

  it('does not seek on a modified click, a drag, or the end of a text selection', () => {
    const { stage, onSeek } = setup();
    fireEvent.click(stage, { ...at(150, 60), shiftKey: true });
    fireEvent.click(stage, { ...at(150, 60), button: 1 });
    fireEvent.click(stage, { ...at(150, 60), detail: 3 }); // the third click of a triple-click

    fireEvent.pointerDown(stage, at(150, 60));
    fireEvent.click(stage, at(190, 60)); // released 40 px away: a drag
    expect(onSeek).not.toHaveBeenCalled();

    const selecting = vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
    } as Selection);
    fireEvent.pointerDown(stage, at(150, 60)); // pressed with text selected: the click clears it
    fireEvent.click(stage, at(150, 60));
    expect(onSeek).not.toHaveBeenCalled();
    selecting.mockRestore();

    fireEvent.pointerDown(stage, at(150, 60)); // the same press, nothing selected, no drag
    fireEvent.click(stage, at(152, 61));
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('tints the bar under a mouse pointer, and nothing for touch or where a seek is refused', () => {
    const { stage, container } = setup({ canSeek: (bar) => bar !== 2 });
    const tint = () => container.querySelector('.bar-tint');
    fireEvent.pointerMove(stage, { ...at(150, 60), pointerType: 'touch' });
    expect(tint()).toBeNull();

    fireEvent.pointerMove(stage, { ...at(150, 60), pointerType: 'mouse' });
    expect(tint()).toHaveStyle({ left: '100px', width: '100px' });
    expect(stage).toHaveClass('is-over-bar');

    fireEvent.pointerMove(stage, { ...at(250, 60), pointerType: 'mouse' }); // bar 2: refused
    expect(tint()).toBeNull();
    expect(stage).not.toHaveClass('is-over-bar');

    fireEvent.pointerMove(stage, { ...at(50, 60), pointerType: 'mouse' });
    expect(tint()).toHaveStyle({ left: '0px' });
    fireEvent.pointerLeave(stage);
    expect(tint()).toBeNull();
  });

  it('leaves a footprint on a bar a key stepped to, and on none that is not drawn', () => {
    const { handle, container } = setup();
    act(() => handle.current!.footprint(2));
    expect(container.querySelector('.bar-footprint')).toHaveStyle({ left: '200px' });
    act(() => handle.current!.footprint(7));
    expect(container.querySelector('.bar-footprint')).toHaveStyle({ left: '200px' });
  });

  it('lets the footprint go when its fade ends', () => {
    const { stage, container } = setup();
    fireEvent.click(stage, at(150, 60));
    fireEvent.animationEnd(container.querySelector('.bar-footprint')!);
    expect(container.querySelector('.bar-footprint')).toBeNull();
  });

  it('forgets the tint and the footprint when the bars move', () => {
    const { stage, container, again } = setup();
    fireEvent.pointerMove(stage, { ...at(150, 60), pointerType: 'mouse' });
    fireEvent.click(stage, at(150, 60));
    expect(container.querySelector('.bar-tint')).not.toBeNull();
    expect(container.querySelector('.bar-footprint')).not.toBeNull();
    again({ layoutKey: 'w600' });
    expect(container.querySelector('.bar-tint')).toBeNull();
    expect(container.querySelector('.bar-footprint')).toBeNull();
  });

  it('reads where the bars are drawn once per layout, not on every pointer move', () => {
    const { stage, reads, again } = setup();
    for (const x of [10, 110, 210, 120, 20]) {
      fireEvent.pointerMove(stage, { ...at(x, 60), pointerType: 'mouse' });
    }
    fireEvent.click(stage, at(150, 60));
    expect(reads()).toBe(3); // one staff line per bar, read once
    again({ layoutKey: 'w600' });
    fireEvent.pointerMove(stage, { ...at(10, 60), pointerType: 'mouse' });
    expect(reads()).toBe(6);
  });

  it('draws what it wraps and seeks nowhere without pages', () => {
    const { stage, onSeek, getByText } = setup({ host: null });
    expect(getByText('the pages')).toBeInTheDocument();
    fireEvent.click(stage, at(150, 60));
    expect(onSeek).not.toHaveBeenCalled();
  });
});
