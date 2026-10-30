import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Switch } from './Switch.js';

afterEach(cleanup);

describe('Switch', () => {
  it('is a real checkbox with role="switch", named by its words, in a 44 px .check row', () => {
    render(
      <Switch checked onChange={vi.fn()}>
        Practice mode
      </Switch>,
    );
    const toggle = screen.getByRole('switch', { name: 'Practice mode' });
    expect(toggle).toHaveAttribute('type', 'checkbox');
    expect(toggle).toBeChecked();
    expect(toggle.closest('label')).toHaveClass('check', 'switch');
    expect(toggle.closest('label')!.querySelector('.is-red')).toBeNull();
  });

  it('draws a track and a quarter note (a head and a stem) beside the input, hidden from screen readers', () => {
    render(
      <Switch checked={false} onChange={vi.fn()}>
        Hear the left hand
      </Switch>,
    );
    const toggle = screen.getByRole('switch', { name: 'Hear the left hand' });
    // The drawing follows the input, so `input:checked + svg` styles it from its state.
    const svg = toggle.nextElementSibling!;
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg.querySelector('.switch-track')).not.toBeNull();
    const note = svg.querySelector('.switch-note')!;
    expect(note.querySelector('.switch-head')).not.toBeNull();
    expect(note.querySelector('.switch-stem')).not.toBeNull();
  });

  it('calls onChange with the new state on a click, a click on its words and Space', async () => {
    const onChange = vi.fn<(on: boolean) => void>();
    const { rerender } = render(
      <Switch checked={false} onChange={onChange}>
        Practice mode
      </Switch>,
    );
    await userEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenLastCalledWith(true);
    await userEvent.click(screen.getByText('Practice mode'));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(true);
    rerender(
      <Switch checked onChange={onChange}>
        Practice mode
      </Switch>,
    );
    screen.getByRole('switch').focus();
    await userEvent.keyboard(' ');
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('hands its ref to the input, so a caller can move the focus when it goes', () => {
    const ref = createRef<HTMLInputElement>();
    render(
      <Switch ref={ref} checked onChange={vi.fn()}>
        Practice mode
      </Switch>,
    );
    expect(ref.current).toBe(screen.getByRole('switch'));
  });
});
