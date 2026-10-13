import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore } from '../app/store.js';
import { LibraryView } from './LibraryView.js';

beforeEach(() =>
  useAppStore.setState({
    view: { name: 'library' },
    settings: { ...DEFAULT_SETTINGS },
    notice: null,
  }),
);
// Testing Library only cleans up automatically when vitest globals are on; they are off here.
afterEach(cleanup);

describe('LibraryView', () => {
  it('shows the welcome, five level sections and 30 piece rows', () => {
    render(<LibraryView />);
    expect(screen.getByRole('heading', { level: 1, name: 'digitus2' })).toBeInTheDocument();
    expect(screen.getByText(/Pick a piece, press play/)).toBeInTheDocument();
    for (const n of [1, 2, 3, 4, 5])
      expect(
        screen.getByRole('heading', { level: 2, name: new RegExp(`^Level ${n}:`) }),
      ).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(30);
  });
  it('has exactly one red element: the start-here button', () => {
    const { container } = render(<LibraryView />);
    const red = container.querySelectorAll('.is-red');
    expect(red).toHaveLength(1);
    expect(red[0]).toHaveTextContent('Start with Twinkle, Twinkle, Little Star');
  });
  it('opens the recommended piece from the start-here button and any piece from its row', async () => {
    render(<LibraryView />);
    await userEvent.click(screen.getByRole('button', { name: /^Start with/ }));
    expect(useAppStore.getState().view).toEqual({
      name: 'score',
      source: { kind: 'library', slug: 'twinkle-twinkle-little-star' },
    });
    await userEvent.click(screen.getByRole('button', { name: /^Open Ode to Joy/ }));
    expect(useAppStore.getState().view).toEqual({
      name: 'score',
      source: { kind: 'library', slug: 'ode-to-joy' },
    });
  });
  it('marks pieces with an editorial fingering and shows durations', () => {
    render(<LibraryView />);
    const row = screen.getByRole('button', { name: /^Open Melody \(Album for the Young/ });
    expect(within(row).getByText("editor's fingering")).toBeInTheDocument();
    expect(within(row).getByText('1:00')).toBeInTheDocument();
  });
  it('describes each row by its duration and tag, since the label replaces the content', () => {
    render(<LibraryView />);
    const row = screen.getByRole('button', { name: /^Open Melody \(Album for the Young/ });
    expect(row).toHaveAccessibleDescription("1:00 editor's fingering");
  });
  it('clears a showing notice when a piece is opened', async () => {
    useAppStore.getState().setNotice('stale');
    render(<LibraryView />);
    await userEvent.click(screen.getByRole('button', { name: /^Open Ode to Joy/ }));
    expect(useAppStore.getState().notice).toBeNull();
  });
  it('links to the about page', async () => {
    render(<LibraryView />);
    await userEvent.click(screen.getByRole('button', { name: 'About and licences' }));
    expect(useAppStore.getState().view.name).toBe('about');
  });
});
