import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MidiImportPanel } from './MidiImportPanel.js';

afterEach(cleanup);

describe('MidiImportPanel', () => {
  it('shows the hand counts and the hand split control, and nothing about quantization', () => {
    render(<MidiImportPanel right={42} left={22} splitMidi={null} onSplitChange={vi.fn()} />);
    expect(screen.queryByText(/quantiz/i)).toBeNull();
    expect(screen.queryByText(/grid/i)).toBeNull();
    expect(screen.getByText('Right hand: 42 notes · left hand: 22 notes')).toBeInTheDocument();
    expect(
      screen.getByText('Keys from the chosen note upward go to the right hand.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Hand split')).toHaveValue('auto');
    expect(screen.getAllByRole('option')).toHaveLength(50);
    expect(screen.getByRole('option', { name: 'Automatic' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'MIDI import' })).toBeInTheDocument();
  });
  it('reports a chosen key and a return to Automatic', async () => {
    const onSplitChange = vi.fn();
    const { rerender } = render(
      <MidiImportPanel right={42} left={22} splitMidi={null} onSplitChange={onSplitChange} />,
    );
    await userEvent.selectOptions(screen.getByLabelText('Hand split'), 'G4');
    expect(onSplitChange).toHaveBeenLastCalledWith(67);
    rerender(<MidiImportPanel right={14} left={50} splitMidi={67} onSplitChange={onSplitChange} />);
    expect(screen.getByLabelText('Hand split')).toHaveValue('67');
    await userEvent.selectOptions(screen.getByLabelText('Hand split'), 'Automatic');
    expect(onSplitChange).toHaveBeenLastCalledWith(null);
  });
  it('has no red element', () => {
    const { container } = render(
      <MidiImportPanel right={1} left={1} splitMidi={null} onSplitChange={vi.fn()} />,
    );
    expect(container.querySelectorAll('.is-red')).toHaveLength(0);
  });
});
