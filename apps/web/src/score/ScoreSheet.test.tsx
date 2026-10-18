import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ScoreSheet } from './ScoreSheet.js';

afterEach(cleanup);

describe('ScoreSheet', () => {
  it('renders the pages as inline SVG inside an image-labelled host', () => {
    const { container } = render(
      <ScoreSheet
        pages={['<svg data-p="1"></svg>', '<svg data-p="2"></svg>']}
        label="Twinkle, Twinkle, Little Star"
      />,
    );
    const host = container.querySelector('.score-sheet')!;
    expect(host).toHaveAttribute('role', 'img');
    // The host is announced with the piece's title in it, whatever the wording around it.
    expect(host).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Twinkle, Twinkle, Little Star'),
    );
    expect(host.querySelectorAll('svg')).toHaveLength(2);
  });
  it('replaces pages instead of appending', () => {
    const { container, rerender } = render(
      <ScoreSheet pages={['<svg data-p="1"></svg>']} label="x" />,
    );
    rerender(<ScoreSheet pages={['<svg data-p="2"></svg>']} label="x" />);
    expect(container.querySelectorAll('svg')).toHaveLength(1);
    expect(container.querySelector('svg')).toHaveAttribute('data-p', '2');
  });
  it('is neither resting nor hopping unless asked', () => {
    const { container } = render(<ScoreSheet pages={[]} label="x" />);
    expect(container.querySelector('.score-sheet')).not.toHaveClass('is-resting');
    expect(container.querySelector('.score-sheet')).not.toHaveClass('is-hopping');
  });
  it('marks resting and hopping independently, and drops each mark when it ends', () => {
    const { container, rerender } = render(
      <ScoreSheet pages={[]} label="x" resting={true} hopping={false} />,
    );
    const host = container.querySelector('.score-sheet')!;
    expect(host).toHaveClass('is-resting');
    expect(host).not.toHaveClass('is-hopping');
    rerender(<ScoreSheet pages={[]} label="x" resting={false} hopping={true} />);
    expect(host).not.toHaveClass('is-resting');
    expect(host).toHaveClass('is-hopping');
  });
});
