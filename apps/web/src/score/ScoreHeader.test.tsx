import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore } from '../app/store.js';
import { FINGER_LEGEND } from './FingerLegend.js';
import { ScoreHeader } from './ScoreHeader.js';

beforeEach(() => useAppStore.setState({ settings: { ...DEFAULT_SETTINGS } }));
afterEach(cleanup);

describe('the finger legend above the music (spec section 12)', () => {
  it('shows until the first Play anywhere', () => {
    render(<ScoreHeader title="T" composer="C" piece={null} onBack={null} />);
    expect(screen.getByText(FINGER_LEGEND)).toHaveClass('finger-legend');
  });
  it('is decided when the view mounts: the first Play does not take it away under the music', () => {
    const { rerender } = render(<ScoreHeader title="T" composer="C" piece={null} onBack={null} />);
    useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, legendSeen: true } });
    rerender(<ScoreHeader title="T" composer="C" piece={null} onBack={null} />);
    expect(screen.getByText(FINGER_LEGEND)).toBeInTheDocument();
  });
  it('is not shown where there is no score to read (the error state)', () => {
    render(<ScoreHeader title="T" composer="C" piece={null} onBack={null} legend={false} />);
    expect(screen.getByRole('heading', { name: 'T' })).toBeInTheDocument();
    expect(screen.queryByText(FINGER_LEGEND)).toBeNull();
  });
  it('stays away once a Play happened', () => {
    useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, legendSeen: true } });
    render(<ScoreHeader title="T" composer="C" piece={null} onBack={null} />);
    expect(screen.queryByText(FINGER_LEGEND)).toBeNull();
  });
});
