import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ImagePages } from './ImagePages.js';
import type { ScanPage } from './model.js';
import * as rotation from './rotation.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
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

it('offers rotation only while page editing is available', async () => {
  const props = {
    pages: [{ id: 'first', file: new File([png], 'first.png') }],
    editable: true,
    busy: false,
    selected: 0,
    onSelect: () => {},
    onChange: () => {},
  };
  const { rerender } = render(<ImagePages {...props} />);
  expect(screen.getByRole('button', { name: 'Rotate 90° clockwise' })).toBeEnabled();
  rerender(<ImagePages {...props} busy />);
  expect(screen.getByRole('button', { name: 'Rotate 90° clockwise' })).toBeDisabled();
  rerender(<ImagePages {...props} editable={false} />);
  expect(screen.queryByRole('button', { name: 'Rotate 90° clockwise' })).toBeNull();
});

it.each(['removed', 'cancelled', 'scanning'] as const)(
  'discards a pending rotation when %s',
  async (reason) => {
    const first = { id: 'first', file: new File([png], 'first.png') };
    const second = { id: 'second', file: new File([png], 'second.png') };
    const changed: ScanPage[][] = [];
    let finish!: (page: ScanPage) => void;
    vi.spyOn(rotation, 'rotateScanPage').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const props = {
      pages: [first, second],
      editable: true,
      busy: false,
      selected: 0,
      onSelect: () => {},
      onChange: (pages: ScanPage[]) => changed.push(pages),
    };
    const { rerender } = render(<ImagePages {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Rotate 90° clockwise' }));
    if (reason === 'removed') rerender(<ImagePages {...props} pages={[second]} />);
    if (reason === 'scanning') rerender(<ImagePages {...props} busy />);
    if (reason === 'cancelled')
      await userEvent.click(screen.getByRole('button', { name: 'Cancel rotation' }));
    finish({
      ...first,
      file: new File([png], 'rotated.png'),
      originalFile: first.file,
      quarterTurns: 1,
    });
    await vi.waitFor(() => expect(screen.queryByText('Rotating image…')).toBeNull());
    expect(changed).toHaveLength(0);
  },
);

it('preserves another page added while rotation is pending and invalidates only the rotated result', async () => {
  const first = { id: 'first', file: new File([png], 'first.png'), xml: 'old first' };
  const second = { id: 'second', file: new File([png], 'second.png'), xml: 'second result' };
  const changed: ScanPage[][] = [];
  let finish!: (page: ScanPage) => void;
  vi.spyOn(rotation, 'rotateScanPage').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const props = {
    pages: [first],
    editable: true,
    busy: false,
    selected: 0,
    onSelect: () => {},
    onChange: (pages: ScanPage[]) => changed.push(pages),
  };
  const { rerender } = render(<ImagePages {...props} />);
  await userEvent.click(screen.getByRole('button', { name: 'Rotate 90° clockwise' }));
  rerender(<ImagePages {...props} pages={[first, second]} />);
  finish({
    ...first,
    file: new File([png], 'rotated.png'),
    originalFile: first.file,
    quarterTurns: 1,
    xml: undefined,
  });
  await vi.waitFor(() => expect(changed).toHaveLength(1));
  expect(changed[0]!.map((p) => p.id)).toEqual(['first', 'second']);
  expect(changed[0]![0]!.xml).toBeUndefined();
  expect(changed[0]![1]).toBe(second);
});

const threePages = (): ScanPage[] =>
  ['a', 'b', 'c'].map((id) => ({ id, file: new File([png], id + '.png') }));
const listProps = {
  busy: false,
  selected: 0,
  onSelect: () => {},
  onChange: () => {},
};

it('tells an editable list to arrange the pages and a fixed list how many originals it holds', () => {
  const { rerender } = render(<ImagePages {...listProps} pages={threePages()} editable />);
  expect(screen.getByText(/Arrange pages/)).toBeVisible();
  expect(screen.queryByText(/original pages/)).toBeNull();
  rerender(<ImagePages {...listProps} pages={threePages()} editable={false} />);
  expect(screen.getByText('3 original pages, in reading order.')).toBeVisible();
  expect(screen.queryByText(/Arrange pages/)).toBeNull();
});

it('numbers the thumbnails from one', () => {
  render(<ImagePages {...listProps} pages={threePages()} editable />);
  const numbers = screen
    .getAllByRole('button', { name: /^Select page / })
    .map((button) => within(button).getByText(/^\d+$/).textContent);
  expect(numbers).toEqual(['1', '2', '3']);
  expect(screen.getByRole('button', { name: /^Select page 3: c\.png/ })).toBeVisible();
});

it('cannot move the last page later but can move any other page later', () => {
  const { rerender } = render(
    <ImagePages {...listProps} pages={threePages()} selected={1} editable />,
  );
  expect(screen.getByRole('button', { name: 'Move page 2 later' })).toBeEnabled();
  rerender(<ImagePages {...listProps} pages={threePages()} selected={2} editable />);
  expect(screen.getByRole('button', { name: 'Move page 3 later' })).toBeDisabled();
  rerender(<ImagePages {...listProps} pages={threePages()} selected={0} editable />);
  expect(screen.getByRole('button', { name: 'Move page 1 later' })).toBeEnabled();
});
