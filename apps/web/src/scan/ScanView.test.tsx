import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAppStore } from '../app/store.js';
import { ScanView } from './ScanView.js';

const { load, renderNotation } = vi.hoisted(() => ({ load: vi.fn(), renderNotation: vi.fn() }));

// DOM tests have no browser workers; pixel/upload behavior is covered by Playwright.
vi.mock('../engine/client.js', () => ({
  createEngineClient: () => ({
    load,
    dispose: () => {},
  }),
}));
vi.mock('../score/render/renderer.js', () => ({
  createRenderer: () => ({
    render: renderNotation,
    dispose: () => {},
  }),
}));
beforeEach(() => {
  load.mockReset().mockResolvedValue({ warnings: [], score: { notes: [{}] } });
  renderNotation.mockReset().mockResolvedValue({ pages: ['<svg/>'] });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('reopens complete individual recognition in page review when combining failed', () => {
  const file = new File(['source'], 'source.png', { type: 'image/png' });
  render(
    <ScanView
      session={{
        id: 'saved',
        file,
        pages: [
          { id: 'first', file, xml: '<score-partwise/>' },
          { id: 'second', file, xml: '<score-partwise/>' },
        ],
      }}
    />,
  );
  expect(screen.getByRole('heading', { name: 'Review the recognition' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Page recognition' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(screen.getByRole('button', { name: 'Combined score' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Connect to this PC' })).toBeNull();
  expect(screen.getByRole('alert')).toHaveTextContent('their notation could not be combined');
  expect(screen.getByRole('button', { name: 'Use for fingerings' })).toBeDisabled();
});

it('waits for valid import and displayed notation before enabling use', async () => {
  let finishImport!: (result: unknown) => void;
  let finishRender!: (result: unknown) => void;
  load.mockReturnValue(
    new Promise((resolve) => {
      finishImport = resolve;
    }),
  );
  renderNotation.mockReturnValue(
    new Promise((resolve) => {
      finishRender = resolve;
    }),
  );
  render(
    <ScanView
      session={{
        id: 'saved',
        file: new File(['source'], 'source.png', { type: 'image/png' }),
        xml: '<score-partwise/>',
      }}
    />,
  );
  const use = screen.getByRole('button', { name: 'Use for fingerings' });
  expect(use).toBeDisabled();
  finishImport({ warnings: [], score: { notes: [{}] } });
  await vi.waitFor(() => expect(use).toBeDisabled());
  finishRender({ pages: ['<svg/>'] });
  await vi.waitFor(() => expect(use).toBeEnabled());
});

it('uses valid restored recognition without a mandatory comparison checkbox', async () => {
  const session = {
    id: 'saved',
    file: new File(['source'], 'source.png', { type: 'image/png' }),
    xml: '<score-partwise/>',
  };
  const openPiece = vi.spyOn(useAppStore.getState(), 'openPiece').mockImplementation(() => {});
  render(<ScanView session={session} />);
  const use = screen.getByRole('button', { name: 'Use for fingerings' });
  await vi.waitFor(() => expect(use).toBeEnabled());
  expect(screen.queryByRole('checkbox')).toBeNull();
  await userEvent.click(use);
  expect(openPiece).toHaveBeenCalledWith({
    kind: 'file',
    name: 'source.musicxml',
    bytes: new TextEncoder().encode(session.xml),
    scan: session,
  });
});

it.each(['import', 'render', 'empty'] as const)(
  'keeps %s failures blocked without a checkbox',
  async (failure) => {
    if (failure === 'import') load.mockRejectedValue(new Error('Unsupported notation'));
    if (failure === 'render') renderNotation.mockRejectedValue(new Error('Cannot render notation'));
    if (failure === 'empty') load.mockResolvedValue({ warnings: [], score: { notes: [] } });
    render(
      <ScanView
        session={{
          id: 'saved',
          file: new File(['source'], 'source.png', { type: 'image/png' }),
          xml: '<score-partwise/>',
        }}
      />,
    );
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Use for fingerings' })).toBeDisabled();
    expect(screen.queryByRole('checkbox')).toBeNull();
  },
);
