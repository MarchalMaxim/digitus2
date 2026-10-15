import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OwnFileLine } from './OwnFileLine.js';
import { useWindowFileDrop } from './ownFile.js';

afterEach(cleanup);

function dragEvent(type: string, types: string[], files: File[] = []): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', { value: { types, files } });
  return e;
}

describe('the end line', () => {
  it('is one quiet line whose file input is named by it, and opens a chosen score', async () => {
    const onFile = vi.fn();
    render(<OwnFileLine onFile={onFile} onRefuse={vi.fn()} />);
    const input = screen.getByLabelText('Open your own score');
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('accept', '.musicxml,.xml,.mxl,.mid,.midi,.png,.jpg,.jpeg,.pdf');
    await userEvent.upload(input, new File(['<score-partwise/>'], 'song.musicxml'));
    await vi.waitFor(() => expect(onFile).toHaveBeenCalledTimes(1));
    expect(document.querySelectorAll('.is-red')).toHaveLength(0);
  });
});

describe('a drop on the window', () => {
  it('shows the frame while files are dragged over the window, and opens the dropped one', async () => {
    const onFile = vi.fn();
    const { result } = renderHook(() => useWindowFileDrop(onFile, vi.fn()));
    expect(result.current).toBe(false);
    act(() => void window.dispatchEvent(dragEvent('dragenter', ['Files'])));
    expect(result.current).toBe(true);
    act(() => void window.dispatchEvent(dragEvent('dragenter', ['Files']))); // onto a child
    act(() => void window.dispatchEvent(dragEvent('dragleave', ['Files'])));
    expect(result.current).toBe(true);
    act(
      () =>
        void window.dispatchEvent(dragEvent('drop', ['Files'], [new File(['<x/>'], 'a.musicxml')])),
    );
    expect(result.current).toBe(false);
    await vi.waitFor(() => expect(onFile).toHaveBeenCalledTimes(1));
  });
  it('a drag without files shows no frame', () => {
    const { result } = renderHook(() => useWindowFileDrop(vi.fn(), vi.fn()));
    act(() => void window.dispatchEvent(dragEvent('dragenter', ['text/plain'])));
    expect(result.current).toBe(false);
  });
  it('leaving the window hides the frame', () => {
    const { result } = renderHook(() => useWindowFileDrop(vi.fn(), vi.fn()));
    act(() => void window.dispatchEvent(dragEvent('dragenter', ['Files'])));
    act(() => void window.dispatchEvent(dragEvent('dragleave', ['Files'])));
    expect(result.current).toBe(false);
  });
});
