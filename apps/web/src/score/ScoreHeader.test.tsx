import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
