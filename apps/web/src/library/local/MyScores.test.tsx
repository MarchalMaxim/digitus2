import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAppStore } from '../../app/store.js';
import { MyScores } from './MyScores.js';
import { useLocalLibrary } from './state.js';

const removal = vi.hoisted(() => ({ run: (_id: string) => {} }));
vi.mock('./library.js', () => ({ removeLocalScore: (id: string) => removal.run(id) }));

beforeEach(() => {
  useLocalLibrary.setState({
    items: ['first', 'second'].map((id) => ({ id, name: id, saved: true, detail: 'file' })),
    failed: false,
  });
  removal.run = (id) =>
    useLocalLibrary.setState((s) => ({ items: s.items.filter((item) => item.id !== id) }));
  useAppStore.getState().setNotice(null);
});
afterEach(cleanup);

function setup() {
  const fallback = document.createElement('button');
  fallback.textContent = 'Library';
  document.body.append(fallback);
  const view = render(<MyScores onOpen={() => {}} onFocusFallback={() => fallback.focus()} />);
  screen.getByText('My scores').click();
  return { fallback, ...view };
}

it('restores the library control when its only saved score is removed', async () => {
  useLocalLibrary.setState((state) => ({ items: state.items.slice(0, 1) }));
  const { fallback } = setup();
  const live = screen.getByTestId('local-score-announcement');
  screen.getByRole('button', { name: 'Remove saved first' }).focus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(fallback).toHaveFocus());
  expect(screen.getByTestId('local-score-announcement')).toBe(live);
  expect(live).toHaveTextContent('Removed first.');
  fallback.remove();
});

it('announces repeated filenames with a fresh child in the same live region', async () => {
  useLocalLibrary.setState((state) => ({
    items: state.items.map((item) => ({ ...item, name: 'same' })),
  }));
  const { fallback } = setup();
  const live = screen.getByTestId('local-score-announcement');
  screen.getAllByRole('button', { name: 'Remove saved same' })[0]!.focus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(live).toHaveTextContent('Removed same.'));
  const previous = live.firstElementChild;
  await userEvent.tab();
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(fallback).toHaveFocus());
  expect(live.firstElementChild).not.toBe(previous);
  expect(live).toHaveAttribute('aria-live', 'polite');
  fallback.remove();
});

it('moves keyboard focus to the next row, then the library after the final removal', async () => {
  const { fallback } = setup();
  const user = userEvent.setup();
  screen.getByRole('button', { name: 'Remove saved first' }).focus();
  await user.keyboard('{Enter}');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Open saved second' })).toHaveFocus(),
  );
  expect(screen.getByTestId('local-score-announcement')).toHaveTextContent('Removed first.');
  await user.tab();
  await user.keyboard('{Enter}');
  await waitFor(() => expect(fallback).toHaveFocus());
  expect(screen.queryByText('My scores')).not.toBeInTheDocument();
  expect(screen.getByTestId('local-score-announcement')).toHaveTextContent('Removed second.');
  fallback.remove();
});

it('uses the previous row when removing the last row', async () => {
  const { fallback } = setup();
  screen.getByRole('button', { name: 'Remove saved second' }).focus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Open saved first' })).toHaveFocus(),
  );
  fallback.remove();
});

it('does not take focus back when the reader moves before lazy removal runs', async () => {
  const { fallback } = setup();
  const remove = screen.getByRole('button', { name: 'Remove saved first' });
  remove.focus();
  act(() => {
    remove.click();
    fallback.focus();
  });
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Remove saved first' })).not.toBeInTheDocument(),
  );
  expect(fallback).toHaveFocus();
  fallback.remove();
});

it('keeps focus and announces no success if removal throws', async () => {
  removal.run = () => {
    throw new Error('unavailable');
  };
  const { fallback } = setup();
  const remove = screen.getByRole('button', { name: 'Remove saved first' });
  remove.focus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(useAppStore.getState().notice).not.toBeNull());
  expect(remove).toHaveFocus();
  expect(screen.getByTestId('local-score-announcement')).toBeEmptyDOMElement();
  removal.run = (id) =>
    useLocalLibrary.setState((state) => ({ items: state.items.filter((item) => item.id !== id) }));
  await userEvent.keyboard('{Enter}');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Open saved second' })).toHaveFocus(),
  );
  fallback.remove();
});
