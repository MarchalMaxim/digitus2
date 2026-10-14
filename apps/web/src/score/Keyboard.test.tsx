import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Keyboard, keyboardRange, keysToShow } from './Keyboard.js';

afterEach(cleanup);

describe('Keyboard', () => {
  it('draws the range and shows finger numbers on pressed keys', () => {
    const { container } = render(
      <Keyboard
        lowMidi={48}
        highMidi={71}
        pressed={[
          { midi: 60, finger: 1, hand: 'R' },
          { midi: 61, finger: 2, hand: 'R' },
        ]}
      />,
    );
    expect(container.querySelectorAll('[data-midi]')).toHaveLength(24);
    const c4 = container.querySelector('[data-midi="60"]')!;
    expect(c4).toHaveClass('is-pressed');
    expect(c4.querySelector('text')).toHaveTextContent('1');
    const cs4 = container.querySelector('[data-midi="61"]')!;
    expect(cs4).toHaveClass('is-black');
    expect(cs4.querySelector('text')).toHaveTextContent('2');
    expect(container.querySelector('[data-midi="62"]')).not.toHaveClass('is-pressed');
    expect(container.querySelectorAll('.is-red')).toHaveLength(0);
  });
  it('never draws a white key narrower than 22 px: a wide range scrolls inside the keyboard', () => {
    const { container } = render(<Keyboard lowMidi={48} highMidi={71} pressed={[]} />);
    const scroller = container.querySelector('.keyboard-scroll')!;
    const svg = scroller.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-label', 'Keyboard');
    expect(svg.style.minWidth).toBe(`${14 * 22}px`);
    // Not a tab stop until it actually scrolls (nothing is laid out here).
    expect(scroller).not.toHaveAttribute('tabindex');
  });
  it('shows every pressed key when they fit, else the most of them, preferring the struck one', () => {
    expect(keysToShow([], 300)).toBeNull();
    const lh = { left: 0, right: 22 };
    const rh1 = { left: 300, right: 322 };
    const rh2 = { left: 344, right: 366 };
    expect(keysToShow([lh, rh1], 400)).toEqual({ left: 0, right: 322 });
    expect(keysToShow([lh, rh1, rh2], 150)).toEqual({ left: 300, right: 366 });
    expect(keysToShow([rh1, lh], 150)).toEqual({ left: 300, right: 322 });
    expect(keysToShow([lh, rh1], 150)).toEqual({ left: 0, right: 22 });
  });
  it('computes a range from C below the lowest note to B above the highest, at least two octaves', () => {
    expect(keyboardRange({ notes: [{ midi: 62 }, { midi: 65 }] } as never)).toEqual({
      lowMidi: 48,
      highMidi: 71,
    });
    expect(keyboardRange({ notes: [{ midi: 43 }, { midi: 84 }] } as never)).toEqual({
      lowMidi: 36,
      highMidi: 95,
    });
  });
});
