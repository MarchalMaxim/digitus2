import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { messages as getT } from '../../i18n/i18n.js';
import { GuidedCamera } from './GuidedCamera.js';

beforeEach(() => vi.stubGlobal('isSecureContext', true));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('stops every track when permission resolves after the dialog was closed', async () => {
  let grant!: (stream: MediaStream) => void;
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: () =>
        new Promise<MediaStream>((resolve) => {
          grant = resolve;
        }),
    },
  });
  const stopped: string[] = [];
  const stream = {
    getTracks: () => [{ stop: () => stopped.push('video') }, { stop: () => stopped.push('extra') }],
  } as unknown as MediaStream;
  const { unmount } = render(
    <GuidedCamera
      maxPages={2}
      onClose={() => {}}
      onComplete={() => {
        throw Error('late files');
      }}
    />,
  );
  expect(screen.getByRole('dialog').querySelectorAll('.is-red')).toHaveLength(1);
  expect(screen.getByRole('button', { name: getT().scan.camera.cancel })).toHaveClass('is-red');
  unmount();
  await act(async () => grant(stream));
  expect(stopped).toEqual(['video', 'extra']);
});

it('offers explicit native fallback after denied permission and rejects nonimage files', async () => {
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: async () => {
        throw new DOMException('denied', 'NotAllowedError');
      },
    },
  });
  const completed: File[][] = [];
  render(
    <GuidedCamera maxPages={2} onClose={() => {}} onComplete={(files) => completed.push(files)} />,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(getT().scan.camera.denied);
  const input = screen.getByLabelText(getT().scan.camera.fallback);
  fireEvent.change(input, {
    target: { files: [new File(['%PDF-'], 'score.pdf', { type: 'application/pdf' })] },
  });
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(getT().scan.camera.processingFailed),
  );
  expect(completed).toEqual([]);
});

it('validates native fallback and finishes only after the reader keeps it', async () => {
  vi.stubGlobal('navigator', { mediaDevices: undefined });
  const completed: File[][] = [];
  render(
    <GuidedCamera maxPages={1} onClose={() => {}} onComplete={(files) => completed.push(files)} />,
  );
  const file = new File([new Uint8Array([255, 216, 255, 1])], 'image.jpg', { type: 'image/jpeg' });
  fireEvent.change(screen.getByLabelText(getT().scan.camera.fallback), {
    target: { files: [file] },
  });
  await screen.findByRole('button', { name: getT().scan.camera.finish(1) });
  expect(completed).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: getT().scan.camera.finish(1) }));
  await waitFor(() => expect(completed[0]).toHaveLength(1));
  expect(completed[0]![0]!.type).toBe('image/jpeg');
});

it('handles track end by releasing the stream and showing restart and fallback', async () => {
  const track = new EventTarget() as MediaStreamTrack;
  const stopped: boolean[] = [];
  track.stop = () => stopped.push(true);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: async () => ({ getTracks: () => [track], getVideoTracks: () => [track] }),
    },
  });
  render(<GuidedCamera maxPages={2} onClose={() => {}} onComplete={() => {}} />);
  await act(async () => {});
  act(() => track.dispatchEvent(new Event('ended')));
  expect(await screen.findByRole('alert')).toHaveTextContent(getT().scan.camera.interrupted);
  expect(stopped.length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: getT().scan.camera.restart })).toBeInTheDocument();
  expect(screen.getByLabelText(getT().scan.camera.fallback)).toHaveAttribute(
    'capture',
    'environment',
  );
});

it('traps focus in the dialog and cancel never returns kept or late files', async () => {
  vi.stubGlobal('navigator', { mediaDevices: undefined });
  const closed: boolean[] = [];
  const completed: File[][] = [];
  render(
    <GuidedCamera
      maxPages={2}
      onClose={() => closed.push(true)}
      onComplete={(files) => completed.push(files)}
    />,
  );
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  const close = screen.getByRole('button', { name: getT().scan.camera.close });
  close.focus();
  fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).not.toBe(close);
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(closed).toEqual([true]);
  expect(completed).toEqual([]);
});

it('rejects native input beyond the remaining page capacity', async () => {
  vi.stubGlobal('navigator', { mediaDevices: undefined });
  const completed: File[][] = [];
  render(
    <GuidedCamera maxPages={1} onClose={() => {}} onComplete={(files) => completed.push(files)} />,
  );
  const files = [1, 2].map(
    (n) => new File([new Uint8Array([255, 216, 255, n])], `${n}.jpg`, { type: 'image/jpeg' }),
  );
  fireEvent.change(screen.getByLabelText(getT().scan.camera.fallback), { target: { files } });
  expect(await screen.findByRole('alert')).toHaveTextContent(getT().scan.camera.tooMany);
  expect(
    screen.queryByRole('button', { name: getT().scan.camera.finish(2) }),
  ).not.toBeInTheDocument();
  expect(completed).toEqual([]);
});

it('rejects native validation that finishes after cancel', async () => {
  vi.stubGlobal('navigator', { mediaDevices: undefined });
  const completed: File[][] = [];
  render(
    <GuidedCamera maxPages={2} onClose={() => {}} onComplete={(files) => completed.push(files)} />,
  );
  const file = new File([new Uint8Array([255, 216, 255, 1])], 'image.jpg', { type: 'image/jpeg' });
  fireEvent.change(screen.getByLabelText(getT().scan.camera.fallback), {
    target: { files: [file] },
  });
  fireEvent.click(screen.getByRole('button', { name: getT().scan.camera.close }));
  await act(async () => {});
  expect(
    screen.queryByRole('button', { name: getT().scan.camera.finish(1) }),
  ).not.toBeInTheDocument();
  expect(completed).toEqual([]);
});

it('cancels a pending permission on navigation and retains a working native fallback', async () => {
  let grant!: (stream: MediaStream) => void;
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: () =>
        new Promise<MediaStream>((resolve) => {
          grant = resolve;
        }),
    },
  });
  const stopped: boolean[] = [];
  render(<GuidedCamera maxPages={2} onClose={() => {}} onComplete={() => {}} />);
  act(() => window.dispatchEvent(new Event('popstate')));
  await act(async () =>
    grant({ getTracks: () => [{ stop: () => stopped.push(true) }] } as unknown as MediaStream),
  );
  expect(stopped).toEqual([true]);
  expect(screen.getByRole('alert')).toHaveTextContent(getT().scan.camera.interrupted);
  const file = new File([new Uint8Array([255, 216, 255, 1])], 'image.jpg', { type: 'image/jpeg' });
  fireEvent.change(screen.getByLabelText(getT().scan.camera.fallback), {
    target: { files: [file] },
  });
  expect(
    await screen.findByRole('button', { name: getT().scan.camera.finish(1) }),
  ).toBeInTheDocument();
});
