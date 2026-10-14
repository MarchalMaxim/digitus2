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
    expect(host).toHaveAttribute('aria-label', 'Score of Twinkle, Twinkle, Little Star');
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
});
