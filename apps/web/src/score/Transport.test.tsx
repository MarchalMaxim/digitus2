import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore } from '../app/store.js';
import { Transport } from './Transport.js';
import type { Playback } from './usePlayback.js';

function playback(
  playing = false,
  loading = false,
): Playback & {
  play: Mock<() => void>;
  pause: Mock<() => void>;
  setLoop: Mock<Playback['setLoop']>;
} {
  return {
    playing,
    loading,
    play: vi.fn<() => void>(),
    pause: vi.fn<() => void>(),
    rewind: vi.fn(),
    positionSec: () => 0,
    loop: null,
    setLoop: vi.fn<Playback['setLoop']>(),
  };
}
afterEach(cleanup);
beforeEach(() =>
  useAppStore.setState({
    view: { name: 'library' },
    settings: { ...DEFAULT_SETTINGS },
    notice: null,
  }),
);

describe('Transport', () => {
  it('shows a red Play when stopped and a plain Pause when playing', () => {
    const { rerender } = render(<Transport playback={playback(false)} measureCount={12} />);
    expect(screen.getByRole('button', { name: 'Play' })).toHaveClass('is-red');
    rerender(<Transport playback={playback(true)} measureCount={12} />);
    expect(screen.getByRole('button', { name: 'Pause' })).not.toHaveClass('is-red');
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
  });
  it('wires play, pause, hands, tempo, metronome, count-in and loop', async () => {
    const pb = playback(false);
    render(<Transport playback={pb} measureCount={12} />);
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(pb.play).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('radio', { name: 'Left hand' }));
    expect(useAppStore.getState().settings.hands).toBe('L');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Metronome' }));
    expect(useAppStore.getState().settings.metronome).toBe(true);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Count-in' }));
    expect(useAppStore.getState().settings.countIn).toBe(false);
    const from = screen.getByLabelText('Loop from bar');
    const to = screen.getByLabelText('Loop to bar');
    await userEvent.clear(from);
    await userEvent.type(from, '3');
    await userEvent.clear(to);
    await userEvent.type(to, '20');
    expect(pb.setLoop).toHaveBeenLastCalledWith({ from: 2, to: 11 });
    await userEvent.click(screen.getByRole('button', { name: 'Clear loop' }));
    expect(pb.setLoop).toHaveBeenLastCalledWith(null);
  });
  it('keeps Play focusable while it cannot start, and ignores it then', async () => {
    // A natively disabled button would drop the focus to <body> while the samples load.
    const loading = playback(false, true);
    const { rerender } = render(<Transport playback={loading} measureCount={12} />);
    const play = screen.getByRole('button', { name: 'Play' });
    expect(play).not.toBeDisabled();
    expect(play).toHaveAttribute('aria-disabled', 'true');
    expect(play).toHaveAttribute('aria-busy', 'true');
    expect(play).toHaveClass('is-red');
    play.focus();
    await userEvent.keyboard('{Enter}');
    expect(loading.play).not.toHaveBeenCalled();
    expect(play).toHaveFocus();

    const notReady = playback(false);
    rerender(<Transport playback={notReady} measureCount={12} disabled />);
    expect(play).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(play);
    expect(notReady.play).not.toHaveBeenCalled();

    const ready = playback(false);
    rerender(<Transport playback={ready} measureCount={12} />);
    expect(play).not.toHaveAttribute('aria-disabled');
    expect(play).not.toHaveAttribute('aria-busy');
    await userEvent.keyboard('{Enter}');
    expect(ready.play).toHaveBeenCalledTimes(1);

    // Playing while the score re-lays out (disabled): Pause still works.
    const relayout = playback(true);
    rerender(<Transport playback={relayout} measureCount={12} disabled />);
    expect(screen.getByRole('button', { name: 'Pause' })).not.toHaveAttribute('aria-disabled');
    await userEvent.keyboard('{Enter}');
    expect(relayout.pause).toHaveBeenCalledTimes(1);
  });
});
