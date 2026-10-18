import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore } from '../app/store.js';
import { FINGER_LEGEND } from './FingerLegend.js';
import { ScoreHeader, useLegendAbove } from './ScoreHeader.js';

beforeEach(() => useAppStore.setState({ settings: { ...DEFAULT_SETTINGS } }));
afterEach(cleanup);

/** The header as the score view mounts it: the legend from the view's once-per-view decision. */
function Header() {
  const legend = useLegendAbove();
  return <ScoreHeader title="T" composer="C" piece={null} onBack={null} legend={legend} />;
}

describe('the finger legend above the music (spec section 12)', () => {
  it('shows until the first Play anywhere', () => {
    render(<Header />);
    expect(screen.getByText(FINGER_LEGEND)).toHaveClass('finger-legend');
  });
  it('is decided when the view mounts: the first Play does not take it away under the music', () => {
    const { rerender } = render(<Header />);
    useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, legendSeen: true } });
    rerender(<Header />);
    expect(screen.getByText(FINGER_LEGEND)).toBeInTheDocument();
  });
  it('is not shown where there is no score to read (the error state)', () => {
    render(<ScoreHeader title="T" composer="C" piece={null} onBack={null} legend={false} />);
    expect(screen.getByRole('heading', { name: 'T' })).toBeInTheDocument();
    expect(screen.queryByText(FINGER_LEGEND)).toBeNull();
  });
  it('stays away once a Play happened', () => {
    useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, legendSeen: true } });
    render(<Header />);
    expect(screen.queryByText(FINGER_LEGEND)).toBeNull();
  });
});

describe('the header around the title', () => {
  it('has a back button only when there is somewhere to go back to, and it goes back', async () => {
    const { container, rerender } = render(
      <ScoreHeader title="T" composer="C" piece={null} onBack={null} />,
    );
    expect(container.querySelector('.back-button')).toBeNull();
    const onBack = vi.fn();
    rerender(<ScoreHeader title="T" composer="C" piece={null} onBack={onBack} />);
    await userEvent.click(container.querySelector('.back-button')!);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('makes the title the page heading', () => {
    render(<ScoreHeader title="T" composer="C" piece={null} onBack={null} />);
    expect(screen.getByRole('heading', { level: 1, name: 'T' })).toBeInTheDocument();
  });

  it('shows the composer in a muted line, and no line when there is none', () => {
    const { container, rerender } = render(
      <ScoreHeader title="T" composer="Robert Schumann" piece={null} onBack={null} />,
    );
    const line = screen.getByText('Robert Schumann');
    expect(line.tagName).toBe('P');
    expect(line).toHaveClass('muted');
    rerender(<ScoreHeader title="T" composer="" piece={null} onBack={null} />);
    expect(container.querySelector('p')).toBeNull();
  });
});
