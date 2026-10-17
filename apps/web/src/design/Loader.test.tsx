import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Loader } from './Loader.js';

describe('Loader', () => {
  it('draws one octave: eight white keys and five black ones, hidden from assistive technology', () => {
    const { container } = render(<Loader tune="scale" />);
    const svg = container.querySelector('svg.loader')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveClass('is-scale');
    expect(svg.querySelectorAll('.loader-key')).toHaveLength(8);
    expect(svg.querySelectorAll('.loader-black')).toHaveLength(5);
  });

  it('carries the red as one group: one key for the scale, three for the chord', () => {
    for (const [tune, keys] of [
      ['scale', 1],
      ['fingering', 1],
      ['chords', 3],
    ] as const) {
      const { container, unmount } = render(<Loader tune={tune} />);
      const red = container.querySelectorAll('.is-red');
      expect(red).toHaveLength(1);
      expect(red[0]!.querySelectorAll('rect')).toHaveLength(keys);
      unmount();
    }
  });

  it('lays the red between the white keys and the black ones, so the black keys stay on top', () => {
    const { container } = render(<Loader tune="scale" />);
    const order = Array.from(container.querySelector('svg')!.children).map((el) =>
      el.classList.contains('is-red') ? 'red' : el.getAttribute('class'),
    );
    expect(order.indexOf('red')).toBe(8);
    expect(order.slice(9, 14).every((c) => c === 'loader-black')).toBe(true);
  });

  it('writes the C major fingering on the keys only while fingering', () => {
    const fingering = render(<Loader tune="fingering" />);
    const digits = fingering.container.querySelectorAll('.loader-digit');
    expect(Array.from(digits, (d) => d.textContent).join('')).toBe('12312345');
    fingering.unmount();
    const scale = render(<Loader tune="scale" />);
    expect(scale.container.querySelectorAll('.loader-digit')).toHaveLength(0);
  });
});
