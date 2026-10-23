import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DRAG_PX,
  drawBurst,
  isEmptyClick,
  NoteBurst,
  type BurstClick,
  type Press,
} from './NoteBurst.js';

afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

function click(target: EventTarget | null, extra: Partial<BurstClick> = {}): BurstClick {
  return {
    button: 0,
    detail: 1,
    clientX: 100,
    clientY: 100,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    defaultPrevented: false,
    target,
    ...extra,
  };
}

const collapsed = { isCollapsed: true } as Selection;

// Motion study 10: notes rise only from a click on nothing in particular.
describe('the note burst', () => {
  it('counts a click on plain text or a blank area, never on anything interactive', () => {
    const page = document.createElement('main');
    page.innerHTML = `
      <h1 tabindex="-1">digitus2</h1>
      <p id="text">Pick a piece</p>
      <button type="button"><span id="in-button">Start</span></button>
      <label><input type="radio" id="radio"> Easy</label>
      <a href="#/about" id="link">About</a>
      <div class="keyboard-scroll" tabindex="0" id="scroller"></div>`;
    document.body.append(page);
    const at = (sel: string) => page.querySelector(sel);
    expect(isEmptyClick(click(at('#text')), collapsed)).toBe(true);
    expect(isEmptyClick(click(at('h1')), collapsed)).toBe(true);
    expect(isEmptyClick(click(page), null)).toBe(true);
    expect(isEmptyClick(click(at('#in-button')), collapsed)).toBe(false);
    expect(isEmptyClick(click(at('#radio')), collapsed)).toBe(false);
    expect(isEmptyClick(click(at('#link')), collapsed)).toBe(false);
    expect(isEmptyClick(click(at('#scroller')), collapsed)).toBe(false);
    page.remove();
  });

  it('ignores a selection being made, another button, a modifier, a handled click', () => {
    const p = document.createElement('p');
    expect(isEmptyClick(click(p), { isCollapsed: false } as Selection)).toBe(false);
    expect(isEmptyClick(click(p, { button: 1 }), collapsed)).toBe(false);
    expect(isEmptyClick(click(p, { shiftKey: true }), collapsed)).toBe(false);
    expect(isEmptyClick(click(p, { altKey: true }), collapsed)).toBe(false);
    expect(isEmptyClick(click(p, { ctrlKey: true }), collapsed)).toBe(false);
    expect(isEmptyClick(click(p, { metaKey: true }), collapsed)).toBe(false);
    expect(isEmptyClick(click(p, { defaultPrevented: true }), collapsed)).toBe(false);
  });

  it('ignores a drag, a click that clears a selection, and a triple-click', () => {
    const p = document.createElement('p');
    const still: Press = { x: 100, y: 100, selected: false };
    expect(isEmptyClick(click(p), collapsed, still)).toBe(true);
    expect(isEmptyClick(click(p), collapsed, { x: 103, y: 102, selected: false })).toBe(true);
    // exactly the drag distance away is still a click; any farther is a drag
    expect(isEmptyClick(click(p), collapsed, { x: 100 - DRAG_PX, y: 100, selected: false })).toBe(
      true,
    );
    expect(isEmptyClick(click(p), collapsed, { x: 100, y: 100 + DRAG_PX, selected: false })).toBe(
      true,
    );
    // a drag across text: the pointer came up farther away than it went down
    expect(isEmptyClick(click(p), collapsed, { x: 100, y: 106, selected: false })).toBe(false);
    expect(isEmptyClick(click(p), collapsed, { x: 60, y: 100, selected: false })).toBe(false);
    // text was selected when the pointer went down: the click only clears it
    expect(isEmptyClick(click(p), collapsed, { x: 100, y: 100, selected: true })).toBe(false);
    // the third click selects a paragraph
    expect(isEmptyClick(click(p, { detail: 3 }), collapsed, still)).toBe(false);
    expect(isEmptyClick(click(p, { detail: 2 }), collapsed, still)).toBe(true);
  });

  it('lets no notes rise from a drag across the page', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
    const { container } = render(<NoteBurst />);
    const p = document.createElement('p');
    document.body.append(p);
    act(() => {
      p.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 20, clientY: 80 }));
      p.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 120, clientY: 80 }));
    });
    expect(container.querySelectorAll('.note-burst')).toHaveLength(0);
    act(() => {
      p.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 120, clientY: 80 }));
      p.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 121, clientY: 81 }));
    });
    expect(container.querySelectorAll('.note-burst')).toHaveLength(1);
    p.remove();
  });

  it('draws every burst fresh: 2 to 4 notes that rise, each its own way', () => {
    const lows = drawBurst(() => 0);
    const highs = drawBurst(() => 0.9999);
    expect(lows).toHaveLength(2);
    expect(highs).toHaveLength(4);
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const shapes = new Set<string>();
    for (let k = 0; k < 50; k++) {
      const notes = drawBurst(random);
      expect(notes.length).toBeGreaterThanOrEqual(2);
      expect(notes.length).toBeLessThanOrEqual(4);
      for (const n of notes) {
        expect(n.dy).toBeLessThan(0);
        expect(Math.hypot(n.dx, n.dy)).toBeLessThan(58);
        expect(n.time).toBeGreaterThanOrEqual(0.8);
        expect(n.time).toBeLessThanOrEqual(1.25);
        expect(n.wait).toBeGreaterThanOrEqual(0);
      }
      shapes.add(notes.map((n) => `${n.kind}${n.dx},${n.dy}`).join(' '));
    }
    expect(shapes.size).toBe(50); // no two alike
  });

  it('draws half as many notes again for a double-click, exactly one of them in the accent', () => {
    expect(drawBurst(() => 0, 'double')).toHaveLength(3);
    expect(drawBurst(() => 0.9999, 'double')).toHaveLength(6);
    let seed = 11;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let k = 0; k < 50; k++) {
      const double = drawBurst(random, 'double');
      expect(double.length).toBeGreaterThanOrEqual(3);
      expect(double.length).toBeLessThanOrEqual(6);
      expect(double.filter((n) => n.accent)).toHaveLength(1);
      for (const n of double) expect(n.dy).toBeLessThan(0);
      expect(drawBurst(random).some((n) => n.accent)).toBe(false);
    }
  });

  it('plays a chord together and a run one note after another', () => {
    // A scripted random: the first draws are the count, then whether it is a chord, the rest 0.5.
    const scripted = (...first: number[]) => {
      const queue = [...first];
      return () => queue.shift() ?? 0.5;
    };
    const gaps = (notes: { wait: number }[]) => {
      const waits = notes.map((n) => n.wait).sort((a, b) => a - b);
      return waits.slice(1).map((w, i) => w - waits[i]!);
    };
    const chord = gaps(drawBurst(scripted(0.5, 0.1)));
    const run = gaps(drawBurst(scripted(0.5, 0.9)));
    expect(chord).toHaveLength(2);
    expect(run).toHaveLength(2);
    for (const g of chord) expect(g).toBeLessThan(0.043);
    for (const g of run) expect(g).toBeGreaterThanOrEqual(0.054);
  });

  it('puts the accent on the note the random draw picks, not always the last', () => {
    // Draws in order: count, chord, fan centre, fan width, direction, step, then the accent.
    const queue = [0.5, 0.9, 0.5, 0.5, 0.5, 0.5, 0.5];
    const notes = drawBurst(() => queue.shift() ?? 0.5, 'double');
    expect(notes).toHaveLength(5);
    expect(notes.map((n) => n.accent)).toEqual([false, false, true, false, false]);
  });

  // Issue 97: the finish at the end of a piece (score/EndBurst.tsx) is drawn in ink only, since
  // the red flying home to Play is the screen's one red. Issue 193: it is a stronger cheer than
  // the double-click's burst, 6 to 8 notes, farther out, larger and longer.
  it('draws the finish with 6 to 8 larger, longer notes that rise, none in the accent', () => {
    expect(drawBurst(() => 0, 'end')).toHaveLength(6);
    expect(drawBurst(() => 0.9999, 'end')).toHaveLength(8);
    let seed = 13;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const counts = new Set<number>();
    let farthest = 0;
    for (let k = 0; k < 200; k++) {
      const end = drawBurst(random, 'end');
      counts.add(end.length);
      expect(end.length).toBeGreaterThanOrEqual(6);
      expect(end.length).toBeLessThanOrEqual(8);
      expect(end.some((n) => n.accent)).toBe(false);
      for (const n of end) {
        expect(n.dy).toBeLessThan(0);
        // 34 to 80 px out (a chord 0.85 of that) plus up to 12 px of rise, and rounding
        const out = Math.hypot(n.dx, n.dy);
        expect(out).toBeGreaterThanOrEqual(28);
        expect(out).toBeLessThanOrEqual(93);
        farthest = Math.max(farthest, out);
        expect(n.scale).toBeGreaterThanOrEqual(0.9);
        expect(n.scale).toBeLessThanOrEqual(1.3);
        expect(Math.abs(n.drift)).toBeLessThanOrEqual(14);
        expect(n.time).toBeGreaterThanOrEqual(1.05);
        expect(n.time).toBeLessThanOrEqual(1.5);
        expect(n.wait).toBeGreaterThanOrEqual(0);
      }
    }
    expect([...counts].sort()).toEqual([6, 7, 8]);
    expect(farthest).toBeGreaterThan(70); // well beyond the double-click's 58 px
  });

  it('fans the finish 120 to 170 degrees wide, centred within 15 degrees of straight up', () => {
    // Scripted: count 7 (0.5), no chord (0.9), then the fan centre, the width, upward, the rest 0.5.
    const fan = (centre: number, width: number) => {
      const queue = [0.5, 0.9, centre, width, 0.5];
      const notes = drawBurst(() => queue.shift() ?? 0.5, 'end');
      const angles = notes.map((n) => (Math.atan2(n.dx, -n.dy) * 180) / Math.PI);
      return { first: angles[0]!, last: angles[angles.length - 1]! };
    };
    const narrow = fan(0.5, 0);
    const wide = fan(0.5, 0.9999);
    // the jitter of each note is +-8 degrees and the dy rise bends the angle by a few more
    expect(wide.last - wide.first).toBeGreaterThan(narrow.last - narrow.first + 40);
    expect(narrow.last - narrow.first).toBeGreaterThan(90);
    const left = fan(0, 0.5);
    const right = fan(0.9999, 0.5);
    expect(right.first + right.last).toBeGreaterThan(left.first + left.last);
    expect(right.first + right.last - (left.first + left.last)).toBeLessThan(80);
  });

  it('keeps the click and double-click shapes exactly as they were', () => {
    // The same seeded draws as before the finish got a row of its own (issue 193), note by note.
    const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const random = seeded(5); // one stream: the double-click's draw follows the click's
    const rows = (shape: 'click' | 'double') =>
      drawBurst(random, shape).map((n) => [
        n.kind,
        n.dx,
        n.dy,
        n.rotate,
        n.scale,
        n.drift,
        n.time,
        n.wait,
        n.accent,
      ]);
    expect(rows('click')).toEqual([
      ['eighth', -14, -34, -17, 0.98, -6, 0.89, 0.065, false],
      ['quarter', 25, -26, 8, 0.81, -1, 1.23, 0.015, false],
    ]);
    expect(rows('double')).toEqual([
      ['quarter', -21, -32, -13, 0.84, 5, 1.23, 0.019, false],
      ['eighth', -24, -54, -7, 0.9, -6, 1, 0.089, false],
      ['eighth', -6, -53, -9, 1.05, 6, 1, 0.172, true],
      ['eighth', 11, -36, 12, 0.98, 8, 1.02, 0.249, false],
      ['eighth', 30, -42, 17, 0.91, 1, 1.1, 0.329, false],
    ]);
  });

  it('draws its notes where the click was, hidden from assistive technology', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
    const { container } = render(<NoteBurst />);
    const p = document.createElement('p');
    document.body.append(p);
    act(() => {
      p.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 120, clientY: 80 }));
    });
    const burst = container.querySelector<HTMLElement>('.note-burst')!;
    expect(burst.style.left).toBe('120px');
    expect(burst.style.top).toBe('80px');
    expect(burst.querySelectorAll('.note-burst-note svg')).toHaveLength(3);
    expect(burst.querySelector<HTMLElement>('.note-burst-note')!.style.translate).toMatch(/px/);
    expect(container.querySelectorAll('.is-red')).toHaveLength(0);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    p.remove();
  });

  it('lets a double-click send up a bigger burst with one note in the accent', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
    const { container } = render(<NoteBurst />);
    const p = document.createElement('p');
    document.body.append(p);
    act(() => {
      p.dispatchEvent(
        new MouseEvent('click', { bubbles: true, clientX: 40, clientY: 40, detail: 2 }),
      );
    });
    expect(container.querySelectorAll('.note-burst-note')).toHaveLength(5);
    expect(container.querySelectorAll('.note-burst-note.is-red')).toHaveLength(1);
    p.remove();
  });

  it('draws nothing under prefers-reduced-motion', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    const { container } = render(<NoteBurst />);
    const p = document.createElement('p');
    document.body.append(p);
    act(() => {
      p.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 120, clientY: 80 }));
    });
    expect(container.querySelectorAll('.note-burst')).toHaveLength(0);
    p.remove();
  });
});
