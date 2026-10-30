import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore } from '../app/store.js';
import { resetPianoForTests } from '../midi/piano.js';
import { OwnFileLine } from './OwnFileLine.js';
import { acceptScoreFiles, useWindowFileDrop } from './ownFile.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (navigator as unknown as Record<string, unknown>).requestMIDIAccess;
  delete (navigator as unknown as Record<string, unknown>).permissions;
  resetPianoForTests();
});

function dragEvent(type: string, types: string[], files: File[] = []): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', { value: { types, files } });
  return e;
}

describe('the end line', () => {
  it('is one quiet line whose file input is named by it, and opens a chosen score', async () => {
    const onFile = vi.fn();
    render(<OwnFileLine onFiles={(files) => acceptScoreFiles(files, onFile, vi.fn())} />);
    const input = screen.getByLabelText('Open your own score');
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('accept', '.musicxml,.xml,.mxl,.mid,.midi,.png,.jpg,.jpeg,.pdf');
    await userEvent.upload(input, new File(['<score-partwise/>'], 'song.musicxml'));
    await vi.waitFor(() => expect(onFile).toHaveBeenCalledTimes(1));
    expect(document.querySelectorAll('.is-red')).toHaveLength(0);
  });
});

describe('the own-score line without the piano line (issue 239)', () => {
  beforeEach(() => {
    useAppStore.setState({ settings: { ...DEFAULT_SETTINGS } });
    resetPianoForTests();
  });
  const withWebMidi = () => {
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      value: () => Promise.resolve(),
      configurable: true,
      writable: true,
    });
    Object.defineProperty(navigator, 'permissions', {
      value: { query: () => Promise.resolve({ state: 'prompt' }) },
      configurable: true,
      writable: true,
    });
    resetPianoForTests();
  };
  const touchOnly = () =>
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('coarse'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  const follows = (first: Element, second: Element) =>
    Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

  it('does not hold the piano line: that stands at the end of the page', () => {
    withWebMidi();
    const { container } = render(<OwnFileLine onFiles={vi.fn()} />);
    expect(container.querySelector('.piano-line')).toBeNull();
    expect(container.querySelector('.own-file-line')!.children).toHaveLength(1);
    expect(container.querySelectorAll('.is-red')).toHaveLength(0);
  });

  it('puts the photo line under the file label on a touch-only device', () => {
    touchOnly();
    const { container } = render(<OwnFileLine onFiles={vi.fn()} />);
    const photo = screen.getByRole('button', { name: 'Photograph a printed score' });
    expect(follows(screen.getByText('Open your own score'), photo)).toBe(true);
    expect(container.querySelector('.own-file-line')!.contains(photo)).toBe(true);
  });
});

describe('a drop on the window', () => {
  it('shows the frame while files are dragged over the window, and opens the dropped one', async () => {
    const onFile = vi.fn();
    const { result } = renderHook(() =>
      useWindowFileDrop((files) => acceptScoreFiles(files, onFile, vi.fn())),
    );
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
    const { result } = renderHook(() => useWindowFileDrop(vi.fn()));
    act(() => void window.dispatchEvent(dragEvent('dragenter', ['text/plain'])));
    expect(result.current).toBe(false);
  });
  it('leaving the window hides the frame', () => {
    const { result } = renderHook(() => useWindowFileDrop(vi.fn()));
    act(() => void window.dispatchEvent(dragEvent('dragenter', ['Files'])));
    act(() => void window.dispatchEvent(dragEvent('dragleave', ['Files'])));
    expect(result.current).toBe(false);
  });
});
