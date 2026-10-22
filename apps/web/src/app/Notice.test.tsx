import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseLocale, resetLocaleForTests } from '../i18n/i18n.js';
import { Notice } from './Notice.js';
import { useAppStore } from './store.js';

beforeEach(() => {
  useAppStore.setState({ notice: null, updateReady: null });
});
afterEach(() => {
  cleanup();
  resetLocaleForTests();
  useAppStore.setState({ notice: null, updateReady: null });
});

describe('Notice', () => {
  it('shows nothing when there is neither a notice nor a newer build', () => {
    const { container } = render(<Notice />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers a waiting newer build with Reload, and Reload runs the offer', async () => {
    const reload = vi.fn();
    useAppStore.getState().setUpdateReady(reload);
    const { container } = render(<Notice />);
    expect(screen.getByRole('status')).toHaveTextContent('A new version is ready.');
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
    // The offer stays until the page reloads or the reader dismisses it; it is never red.
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(container.querySelector('.is-red')).toBeNull();
  });

  it('takes the offer away with Dismiss', async () => {
    useAppStore.getState().setUpdateReady(vi.fn());
    render(<Notice />);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(useAppStore.getState().updateReady).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows a refusal first, and the offer again once the refusal is gone', async () => {
    useAppStore.setState({ notice: 'That file is too large.' });
    useAppStore.getState().setUpdateReady(vi.fn());
    render(<Notice />);
    expect(screen.getByRole('status')).toHaveTextContent('That file is too large.');
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();
    // Opening a piece clears the notice (LibraryView); the offer is still there.
    act(() => useAppStore.getState().setNotice(null));
    expect(screen.getByRole('status')).toHaveTextContent('A new version is ready.');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeVisible();
  });

  it('speaks the language of the reader', async () => {
    await act(async () => {
      await chooseLocale('fr');
    });
    useAppStore.getState().setUpdateReady(vi.fn());
    render(<Notice />);
    expect(screen.getByRole('status')).toHaveTextContent('Une nouvelle version est prête.');
    expect(screen.getByRole('button', { name: 'Recharger' })).toBeVisible();
  });
});
