import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore } from '../app/store.js';
import { LibraryView } from './LibraryView.js';

beforeEach(() =>
  useAppStore.setState({
    view: { name: 'library' },
    settings: { ...DEFAULT_SETTINGS },
    notice: null,
    libraryScrollY: 0,
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
  // Polish plan Task 5, review S4: no screen said what the numbers mean or which hand they are for.
  it('explains the finger numbers under the welcome', () => {
    render(<LibraryView />);
    const legend = screen.getByText(
      'Finger numbers: 1 is the thumb and 5 the little finger, in both hands. The upper staff is the right hand, the lower staff the left.',
    );
    expect(legend.tagName).toBe('P');
    expect(legend.closest('header')).toHaveClass('welcome');
    expect(legend).not.toHaveClass('is-red');
  });
  // Polish plan Task 6, review L1: the drop zone sat after all 30 rows, and nothing near the top
  // said a reader can open their own score.
  it('links from the welcome to the drop zone: the link brings it into view and focuses its chooser', async () => {
    const scrolled: Element[] = [];
    const scrollIntoView = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(function (this: Element) {
        scrolled.push(this);
      });
    try {
      const { container } = render(<LibraryView />);
      const link = screen.getByRole('link', { name: 'Open your own MusicXML file' });
      expect(link.closest('header')).toHaveClass('welcome');
      expect(link).not.toHaveClass('is-red');
      // A link, not one more "Open …" button among the 30 piece rows.
      expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(30);
      await userEvent.click(link);
      expect(scrolled).toEqual([screen.getByTestId('drop-zone')]);
      expect(screen.getByLabelText('choose a file')).toHaveFocus();
      // Nothing opened, the address unchanged.
      expect(useAppStore.getState().view).toEqual({ name: 'library' });
      expect(location.hash).toBe('');
      expect(container.querySelectorAll('.is-red')).toHaveLength(1);
    } finally {
      scrollIntoView.mockRestore();
    }
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
  it('remembers how far the list was scrolled when it opens a piece, a file or the about page', async () => {
    render(<LibraryView />);
    window.scrollTo({ top: 1200 });
    await userEvent.click(screen.getByRole('button', { name: /^Open Ode to Joy/ }));
    expect(useAppStore.getState().libraryScrollY).toBe(1200);
    window.scrollTo({ top: 2400 });
    await userEvent.upload(
      screen.getByLabelText('choose a file'),
      new File(['<score-partwise/>'], 'mine.musicxml', { type: 'application/xml' }),
    );
    await vi.waitFor(() =>
      expect(useAppStore.getState().view).toMatchObject({
        name: 'score',
        source: { kind: 'file', name: 'mine.musicxml' },
      }),
    );
    expect(useAppStore.getState().libraryScrollY).toBe(2400);
    window.scrollTo({ top: 2900 });
    await userEvent.click(screen.getByRole('button', { name: 'About and licences' }));
    expect(useAppStore.getState().libraryScrollY).toBe(2900);
    window.scrollTo({ top: 0 });
  });
  it('remembers the scroll when the list is left through the history, which no control sees', () => {
    // The browser's Forward or an edited address: the list unmounts without a click.
    const { unmount } = render(<LibraryView />);
    window.scrollTo({ top: 700 });
    fireEvent.scroll(window);
    expect(useAppStore.getState().libraryScrollY).toBe(0); // written once, when the list goes
    unmount();
    expect(useAppStore.getState().libraryScrollY).toBe(700);
    window.scrollTo({ top: 0 });
  });
  it('ignores scrolls once the address names another view (a history step restoring its offset)', () => {
    const { unmount } = render(<LibraryView />);
    window.scrollTo({ top: 500 });
    fireEvent.scroll(window);
    location.hash = '#/piece/ode-to-joy';
    try {
      window.scrollTo({ top: 40 });
      fireEvent.scroll(window);
      unmount();
    } finally {
      location.hash = '';
      window.scrollTo({ top: 0 });
    }
    expect(useAppStore.getState().libraryScrollY).toBe(500);
  });
  it('leaves the remembered scroll alone when the list goes without scrolling', () => {
    useAppStore.setState({ libraryScrollY: 1852 });
    const { unmount } = render(<LibraryView />);
    unmount();
    expect(useAppStore.getState().libraryScrollY).toBe(1852);
  });
});
