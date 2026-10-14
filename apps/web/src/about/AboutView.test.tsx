import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { pieces } from '../library/manifest.js';
import { AboutView } from './AboutView.js';

// Testing Library only cleans up automatically when vitest globals are on; they are off here.
afterEach(cleanup);

describe('AboutView', () => {
  it('credits Verovio, smplr and the samples, and lists every piece with its licence', () => {
    render(<AboutView />);
    expect(screen.getByRole('link', { name: /Verovio/ })).toHaveAttribute(
      'href',
      'https://github.com/rism-digital/verovio',
    );
    expect(screen.getByText(/LGPL-3\.0-or-later/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /smplr/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'midi-file' })).toHaveAttribute(
      'href',
      'https://github.com/carter-thaxton/midi-file',
    );
    expect(screen.getAllByRole('row')).toHaveLength(pieces.length + 1);
    expect(
      screen.getAllByRole('link', { name: 'CC BY-SA 2.5' }).length +
        screen.getAllByRole('link', { name: 'CC BY-SA 3.0' }).length,
    ).toBe(5);
    for (const p of pieces.filter((p) => p.source.typesetter))
      expect(screen.getAllByText(new RegExp(p.source.typesetter!)).length).toBeGreaterThan(0);
  });
  it('has exactly one red element, the back button', () => {
    const { container } = render(<AboutView />);
    const red = container.querySelectorAll('.is-red');
    expect(red).toHaveLength(1);
    expect(red[0]).toHaveTextContent('Back to the library');
  });
});
