import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ImagePages } from './ImagePages.js';
import type { ScanPage } from './model.js';

afterEach(cleanup);
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
it('adds validated images to the current order and cannot resurrect a removed page', async () => {
  const original: ScanPage[] = ['first', 'removed'].map((id) => ({
    id,
    file: new File([png], id + '.png'),
  }));
  const next: ScanPage[][] = [];
  const props = {
    pages: original,
    editable: true,
    busy: false,
    selected: 0,
    onSelect: () => {},
    onChange: (pages: ScanPage[]) => next.push(pages),
  };
  const { rerender } = render(<ImagePages {...props} />);
  let resolve!: (bytes: ArrayBuffer) => void;
  const bytes = new Promise<ArrayBuffer>((done) => {
    resolve = done;
  });
  const adding = new File(['x'], 'new.png');
  vi.spyOn(adding, 'slice').mockReturnValue({ arrayBuffer: () => bytes } as Blob);
  await userEvent.upload(screen.getByLabelText('Add page images'), adding);
  rerender(<ImagePages {...props} pages={[original[0]!]} />);
  resolve(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer);
  await vi.waitFor(() => expect(next).toHaveLength(1));
  expect(next[0]!.map((page) => page.file.name)).toEqual(['first.png', 'new.png']);
});

it('does not append an image after scanning starts while validation is pending', async () => {
  const pages: ScanPage[] = [{ id: 'first', file: new File([png], 'first.png') }];
  const next: ScanPage[][] = [];
  const props = {
    pages,
    editable: true,
    busy: false,
    selected: 0,
    onSelect: () => {},
    onChange: (value: ScanPage[]) => next.push(value),
  };
  const { rerender } = render(<ImagePages {...props} />);
  let resolve!: (bytes: ArrayBuffer) => void;
  const bytes = new Promise<ArrayBuffer>((done) => {
    resolve = done;
  });
  const adding = new File(['x'], 'new.png');
  vi.spyOn(adding, 'slice').mockReturnValue({ arrayBuffer: () => bytes } as Blob);
  await userEvent.upload(screen.getByLabelText('Add page images'), adding);
  rerender(<ImagePages {...props} busy />);
  resolve(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer);
  await vi.waitFor(() => expect(screen.getByRole('alert')).toBeVisible());
  expect(next).toHaveLength(0);
});
