import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  createReport: vi.fn(async (_report: unknown) => {}),
  listShared: vi.fn(
    async (
      _limit: number,
      _after?: string,
    ): Promise<Array<{ id: string; title: string; composer: string; created: string }>> => [],
  ),
}));
vi.mock('./store.js', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  ...store,
}));

import ReportSheet from './ReportSheet.js';
import SharedShelf from './SharedShelf.js';

const id = 'c'.repeat(32);
beforeEach(() => {
  store.createReport.mockReset();
  store.createReport.mockResolvedValue(undefined);
  store.listShared.mockReset();
  store.listShared.mockResolvedValue([]);
});
afterEach(cleanup);

it('a report needs a reason, and for a copyright claim a way to reply', async () => {
  const user = userEvent.setup();
  render(<ReportSheet id={id} onClose={() => {}} />);
  await user.click(screen.getByRole('button', { name: 'Send report' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Choose a reason.');
  await user.click(screen.getByLabelText('It is under copyright'));
  expect(screen.getByLabelText('How can the owner reply to you?')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Send report' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Say how the owner can reply to you.');
  expect(store.createReport).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText('How can the owner reply to you?'), 'me@example.org');
  await user.type(screen.getByLabelText('Anything else (optional)'), ' The Beatles ');
  await user.click(screen.getByRole('button', { name: 'Send report' }));
  await screen.findByText('Report sent');
  expect(store.createReport).toHaveBeenCalledOnce();
  expect(store.createReport).toHaveBeenCalledWith({
    score: id,
    reason: 'copyright',
    note: 'The Beatles',
    reply: 'me@example.org',
  });
  expect(
    screen.getByText('The owner reads every report and removes a score that should not be here.'),
  ).toBeVisible();
  expect(screen.getByRole('button', { name: 'Back to the score' })).toBeVisible();
});

it('the other reasons ask for no reply and send none', async () => {
  const user = userEvent.setup();
  render(<ReportSheet id={id} onClose={() => {}} />);
  await user.click(screen.getByLabelText('It does not play right'));
  expect(screen.queryByLabelText('How can the owner reply to you?')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Send report' }));
  await screen.findByText('Report sent');
  expect(store.createReport).toHaveBeenCalledWith({
    score: id,
    reason: 'broken',
    note: '',
    reply: '',
  });
});

it('a report that cannot be sent says so and leads to a removal request on GitHub', async () => {
  store.createReport.mockRejectedValue(new Error('offline'));
  const user = userEvent.setup();
  render(<ReportSheet id={id} onClose={() => {}} />);
  await user.click(screen.getByLabelText('It is offensive or spam'));
  await user.click(screen.getByRole('button', { name: 'Send report' }));
  const link = await screen.findByRole('link', { name: 'Ask for removal on GitHub' });
  expect(link).toHaveAttribute(
    'href',
    'https://github.com/MarchalMaxim/digitus2/issues/new?template=remove-a-score.yml',
  );
  expect(screen.getByRole('alert')).toHaveTextContent('The report could not be sent.');
});

const row = (n: number) => ({
  id: n.toString(16).padStart(32, '0'),
  title: `Piece ${n}`,
  composer: n % 2 ? 'Composer' : '',
  created: `2026-10-27T10:00:${String(60 - n).padStart(2, '0')}Z`,
});

it('the shelf draws nothing when there are no shared scores or the store is unreachable', async () => {
  const { container } = render(<SharedShelf onOpen={() => {}} />);
  await waitFor(() => expect(store.listShared).toHaveBeenCalledWith(5));
  expect(container).toBeEmptyDOMElement();
  cleanup();
  store.listShared.mockRejectedValue(new Error('offline'));
  const failed = render(<SharedShelf onOpen={() => {}} />);
  await waitFor(() => expect(store.listShared).toHaveBeenCalledTimes(2));
  expect(failed.container).toBeEmptyDOMElement();
});

it('the shelf shows the five newest, opens one, and asks for 20 more only when five came back', async () => {
  const user = userEvent.setup();
  const onOpen = vi.fn();
  store.listShared.mockResolvedValueOnce([1, 2, 3, 4, 5].map(row));
  render(<SharedShelf onOpen={onOpen} />);
  await screen.findByRole('heading', { name: 'Shared by readers' });
  expect(screen.getAllByRole('button', { name: /^Open shared Piece/ })).toHaveLength(5);
  await user.click(screen.getByRole('button', { name: 'Open shared Piece 2' }));
  expect(onOpen).toHaveBeenCalledWith(row(2).id);
  store.listShared.mockResolvedValueOnce([6, 7].map(row));
  await user.click(screen.getByRole('button', { name: 'More shared scores' }));
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: /^Open shared Piece/ })).toHaveLength(7),
  );
  expect(store.listShared).toHaveBeenLastCalledWith(20, row(5).created);
  // Fewer than a full page came back: nothing more to ask for.
  expect(screen.queryByRole('button', { name: 'More shared scores' })).toBeNull();
});

it('the shelf offers no More when fewer than five came back', async () => {
  store.listShared.mockResolvedValueOnce([1, 2].map(row));
  render(<SharedShelf onOpen={() => {}} />);
  await screen.findByRole('heading', { name: 'Shared by readers' });
  expect(screen.queryByRole('button', { name: 'More shared scores' })).toBeNull();
});
