import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawBurst, isEmptyClick, NoteBurst, type BurstClick } from './NoteBurst.js';

afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

function click(target: EventTarget | null, extra: Partial<BurstClick> = {}): BurstClick {
  return {
    button: 0,
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
    expect(isEmptyClick(click(p, { defaultPrevented: true }), collapsed)).toBe(false);
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
        expect(Math.hypot(n.dx, n.dy)).toBeLessThan(50);
        expect(n.time).toBeGreaterThanOrEqual(0.8);
        expect(n.time).toBeLessThanOrEqual(1.25);
        expect(n.wait).toBeGreaterThanOrEqual(0);
      }
      shapes.add(notes.map((n) => `${n.kind}${n.dx},${n.dy}`).join(' '));
    }
    expect(shapes.size).toBe(50); // no two alike
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
