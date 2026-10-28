import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAppStore } from '../../app/store.js';
import { en } from '../../i18n/en/index.js';
import { MyScores } from './MyScores.js';
import { useLocalLibrary } from './state.js';

const library = vi.hoisted(() => ({
  shareDraft: vi.fn(async () => ({ title: 'Étude', composer: 'Czerny' })),
  shareLocalScore: vi.fn(async (_id: string, _title: string, _composer: string) => {}),
  withdrawLocalScore: vi.fn(async (_id: string) => {}),
  checkSharing: vi.fn(async () => {}),
}));
vi.mock('./library.js', () => library);

beforeEach(() => {
  library.shareDraft.mockClear();
  library.shareLocalScore.mockReset();
  library.withdrawLocalScore.mockClear();
  useLocalLibrary.setState({
    items: [
      { id: 'a', name: 'a.musicxml', saved: true, detail: 'file', sharing: 'can' },
      { id: 'b', name: 'b.mid', saved: true, detail: 'file' },
      { id: 'c', name: 'c.musicxml', saved: true, detail: 'file', sharing: 'waiting' },
      { id: 'd', name: 'd.musicxml', saved: true, detail: 'file', sharing: 'shared' },
      { id: 'e', name: 'e.musicxml', saved: true, detail: 'file', sharing: 'again' },
    ],
    failed: false,
  });
  useAppStore.getState().setNotice(null);
});
afterEach(cleanup);
// The first Share loads the sheet's chunk, which the test runner has to transform.
const SLOW = { timeout: 15_000 };

function setup() {
  render(<MyScores onOpen={() => {}} onFocusFallback={() => {}} />);
  screen.getByText('My scores').click();
}

it('offers Share on eligible rows, Withdraw on a waiting one, and nothing on a MIDI or shared row', async () => {
  setup();
  expect(screen.getByRole('button', { name: 'Share a.musicxml' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Share e.musicxml' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Withdraw c.musicxml from review' })).toBeVisible();
  expect(screen.queryByRole('button', { name: /^Share b\.mid/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /^(Share|Withdraw) d\.musicxml/ })).toBeNull();
  expect(screen.getAllByRole('button', { name: /^Share / })).toHaveLength(2);
  expect(screen.getByText('Waiting for review')).toBeVisible();
  expect(screen.getByText('Shared')).toBeVisible();
  expect(screen.getByText('Not shared')).toBeVisible();
  await waitFor(() => expect(library.checkSharing).toHaveBeenCalled());
});

it('Share opens the sheet prefilled; without the tick it sends nothing and asks for it', async () => {
  const user = userEvent.setup();
  setup();
  await user.click(screen.getByRole('button', { name: 'Share a.musicxml' }));
  const sheet = await screen.findByRole('dialog', { name: 'Share with other readers' }, SLOW);
  expect(screen.getByLabelText('Title')).toHaveValue('Étude');
  expect(screen.getByLabelText('Composer')).toHaveValue('Czerny');
  expect(sheet).toHaveTextContent(
    'Share only music that is out of copyright or that you wrote. The owner reads each score before anyone else can find it.',
  );
  await user.click(screen.getByRole('button', { name: 'Share' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Tick the box to share this score.');
  expect(screen.getByLabelText('This music is free to share')).toHaveFocus();
  expect(library.shareLocalScore).not.toHaveBeenCalled();
});

it('with the tick, Share sends once with the typed fields, closes the sheet and says it was sent', async () => {
  const user = userEvent.setup();
  setup();
  await user.click(screen.getByRole('button', { name: 'Share a.musicxml' }));
  await screen.findByRole('dialog', {}, SLOW);
  await user.clear(screen.getByLabelText('Title'));
  await user.type(screen.getByLabelText('Title'), 'My title');
  await user.click(screen.getByLabelText('This music is free to share'));
  await user.click(screen.getByRole('button', { name: 'Share' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(library.shareLocalScore).toHaveBeenCalledOnce();
  expect(library.shareLocalScore).toHaveBeenCalledWith('a', 'My title', 'Czerny');
  expect(
    screen.getByText(
      'Sent for review. It appears under Shared by readers once the owner has read it.',
    ),
  ).toBeVisible();
});

it('a store that cannot be reached closes the sheet and shows the notice', async () => {
  library.shareLocalScore.mockRejectedValue(new Error('offline'));
  const user = userEvent.setup();
  setup();
  await user.click(screen.getByRole('button', { name: 'Share a.musicxml' }));
  await screen.findByRole('dialog', {}, SLOW);
  await user.click(screen.getByLabelText('This music is free to share'));
  await user.click(screen.getByRole('button', { name: 'Share' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const notice = useAppStore.getState().notice;
  expect(
    typeof notice === 'function'
      ? notice(await import('../../i18n/en/index.js').then((m) => m.en))
      : notice,
  ).toBe('Sharing is not available right now. Try again later.');
});

it('a score too large for the store closes the sheet and says so', async () => {
  library.shareLocalScore.mockRejectedValue(
    Object.assign(new Error('the score is too large to share'), { name: 'ScoreTooLarge' }),
  );
  const user = userEvent.setup();
  setup();
  await user.click(screen.getByRole('button', { name: 'Share a.musicxml' }));
  await screen.findByRole('dialog', {}, SLOW);
  await user.click(screen.getByLabelText('This music is free to share'));
  await user.click(screen.getByRole('button', { name: 'Share' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const notice = useAppStore.getState().notice;
  expect(typeof notice === 'function' ? notice(en) : notice).toBe(
    'This score is too large to share.',
  );
});

it('Cancel and Escape close the sheet without sending', async () => {
  const user = userEvent.setup();
  setup();
  await user.click(screen.getByRole('button', { name: 'Share a.musicxml' }));
  await screen.findByRole('dialog', {}, SLOW);
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Share a.musicxml' }));
  await screen.findByRole('dialog', {}, SLOW);
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(library.shareLocalScore).not.toHaveBeenCalled();
});

it('Withdraw asks the library to take the upload back', async () => {
  const user = userEvent.setup();
  setup();
  await user.click(screen.getByRole('button', { name: 'Withdraw c.musicxml from review' }));
  expect(library.withdrawLocalScore).toHaveBeenCalledWith('c');
});
