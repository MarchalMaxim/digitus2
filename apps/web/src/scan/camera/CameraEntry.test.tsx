import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { CameraEntry } from './CameraEntry.js';

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
vi.mock('./GuidedCamera.js', () => ({
  GuidedCamera: ({
    onComplete,
    onClose,
    maxPages,
  }: {
    onComplete(files: File[]): void;
    onClose(): void;
    maxPages: number;
  }) => (
    <div role="dialog" aria-label="Camera">
      <span>Capacity {maxPages}</span>
      <button
        onClick={() => onComplete([new File([png], 'page-1.png'), new File([png], 'page-2.png')])}
      >
        Finish camera
      </button>
      <button onClick={onClose}>Cancel camera</button>
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('has-guided-camera');
});

it('opens guided acquisition and delivers the whole reviewed page batch once', async () => {
  const onFiles = vi.fn();
  render(<CameraEntry onFiles={onFiles} label="Take a photo" maxPages={7} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Take a photo' }));
  expect(await screen.findByText('Capacity 7')).toBeVisible();
  expect(document.documentElement).toHaveClass('has-guided-camera');
  await userEvent.click(screen.getByRole('button', { name: 'Finish camera' }));
  expect(onFiles).toHaveBeenCalledTimes(1);
  expect(onFiles.mock.calls[0]![0].map((f: File) => f.name)).toEqual(['page-1.png', 'page-2.png']);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.documentElement).not.toHaveClass('has-guided-camera');
});

it('cancel returns focus without importing and busy changes close the camera', async () => {
  const onFiles = vi.fn();
  const { rerender } = render(<CameraEntry onFiles={onFiles} label="Take a photo" />);
  const trigger = screen.getByRole('button', { name: 'Take a photo' });
  await userEvent.click(trigger);
  await userEvent.click(await screen.findByRole('button', { name: 'Cancel camera' }));
  expect(onFiles).not.toHaveBeenCalled();
  expect(trigger).toHaveFocus();
  await userEvent.click(trigger);
  await screen.findByRole('dialog');
  rerender(<CameraEntry onFiles={onFiles} label="Take a photo" disabled />);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.documentElement).not.toHaveClass('has-guided-camera');
});

it('retains the native camera fallback and rejects a batch beyond the remaining capacity', async () => {
  const onFiles = vi.fn();
  const { container } = render(<CameraEntry onFiles={onFiles} label="Take a photo" maxPages={1} />);
  expect(container.querySelector('input[capture="environment"]')).toHaveAttribute(
    'accept',
    'image/jpeg,image/png',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Take a photo' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Finish camera' }));
  expect(onFiles).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toBeVisible();
});
