import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore } from '../app/store.js';
import { FINGER_LEGEND } from '../score/FingerLegend.js';
import { LibraryView } from './LibraryView.js';

beforeEach(() =>
  useAppStore.setState({
    view: { name: 'library' },
    settings: { ...DEFAULT_SETTINGS },
    notice: null,
    libraryScrollY: 0,
    libraryLevel: null,
    libraryQuery: '',
  }),
);
// Testing Library only cleans up automatically when vitest globals are on; they are off here.
afterEach(cleanup);

const rows = () => screen.getAllByRole('button', { name: /^Open / });
const h3s = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);

describe('LibraryView: the units (spec section 3)', () => {
  it('is the name, the sentence, one red button, the level pills and one level', () => {
    const { container } = render(<LibraryView />);
    expect(screen.getByRole('heading', { level: 1, name: 'digitus2' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Finger numbers for piano. Pick a piece, press play, and follow the red note.',
      ),
    ).toBeInTheDocument();
    const start = screen.getByRole('button', { name: 'Start with Twinkle, Twinkle, Little Star' });
    expect(start).toHaveClass('is-red');
    expect(container.querySelectorAll('.is-red')).toHaveLength(1);
    expect(rows()).toHaveLength(24);
    expect(h3s()).toEqual(["Children's songs", 'Songs before 1929', 'Other pieces']);
  });
  it('drops the legend, the Start-here card, the file link and the tags', () => {
    render(<LibraryView />);
    expect(screen.queryByText(FINGER_LEGEND)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Start here' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Open your own/ })).toBeNull();
    expect(screen.queryByText("editor's fingering")).toBeNull();
    expect(screen.queryByText(/^Level \d/)).toBeNull();
  });
  it('shows a row as title, length and a composer line only when it says something', () => {
    render(<LibraryView />);
    const twinkle = screen.getByRole('button', {
      name: 'Open Twinkle, Twinkle, Little Star by Traditional',
    });
    expect(twinkle).toHaveTextContent('Twinkle, Twinkle, Little Star0:29');
    expect(twinkle).toHaveAccessibleDescription('0:29');
    const lullaby = screen.getByRole('button', { name: /^Open Schlaf, Kindlein, schlaf/ });
    expect(within(lullaby).getByText('Johann Friedrich Reichardt')).toHaveClass('composer');
  });
});

describe('LibraryView: the level pills (spec 4.1, 6.3, 11)', () => {
  it('is a radio group named Level, First steps chosen, described by the level line', () => {
    render(<LibraryView />);
    const group = screen.getByRole('group', { name: 'Level' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.closest('label')!.textContent)).toEqual([
      'First steps',
      'Easy',
      'Moderate',
      'Intermediate',
      'Challenging',
      'Advanced',
    ]);
    expect(within(group).getByRole('radio', { name: 'First steps' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: 'First steps' })).toHaveAccessibleDescription(
      'Each hand stays in one place.',
    );
    expect(group.querySelectorAll('.is-red')).toHaveLength(0);
  });
  it('choosing Moderate shows its 83 pieces under their collections and says so once', async () => {
    render(<LibraryView />);
    await userEvent.click(screen.getByRole('radio', { name: 'Moderate' }));
    expect(screen.getByRole('radio', { name: 'Moderate' })).toBeChecked();
    expect(rows()).toHaveLength(83);
    expect(h3s()[0]).toBe('Notebook for Anna Magdalena Bach (1725)');
    expect(screen.getByText('More notes and wider reaches.')).toBeInTheDocument();
    expect(useAppStore.getState().libraryLevel).toBe(3);
    await waitFor(
      () =>
        expect(screen.getByTestId('library-announcement')).toHaveTextContent('Moderate: 83 pieces'),
      { timeout: 2000 },
    );
  });
  it('choosing Advanced shows its 50 pieces and hides unneeded genre filters', async () => {
    render(<LibraryView />);
    await userEvent.click(screen.getByRole('radio', { name: 'Advanced' }));
    expect(rows()).toHaveLength(50);
    expect(h3s()[0]).toBe('Bach, The Well-Tempered Clavier');
    expect(useAppStore.getState().libraryLevel).toBe(6);
    expect(screen.queryByRole('group', { name: 'Genre' })).toBeNull();
  });
  it('says nothing on arrival', async () => {
    render(<LibraryView />);
    await new Promise((r) => setTimeout(r, 700));
    expect(screen.getByTestId('library-announcement')).toHaveTextContent('');
  });
  it('opens on the level chosen earlier in this visit', () => {
    useAppStore.setState({ libraryLevel: 4 });
    render(<LibraryView />);
    expect(screen.getByRole('radio', { name: 'Intermediate' })).toBeChecked();
    expect(rows()).toHaveLength(37);
  });
});

describe('LibraryView: the returning reader (spec 16)', () => {
  it('continues with the last piece played, on its level', () => {
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, lastPlayed: 'bach-minuet-g-major-bwv-anh-114' },
    });
    const { container } = render(<LibraryView />);
    expect(screen.getByRole('button', { name: 'Continue with Minuet in G major' })).toHaveClass(
      'is-red',
    );
    expect(container.querySelectorAll('.is-red')).toHaveLength(1);
    expect(screen.getByRole('radio', { name: 'Easy' })).toBeChecked();
  });
  it('a lastPlayed slug that is gone falls back to Start and First steps', () => {
    useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, lastPlayed: 'no-such-piece' } });
    render(<LibraryView />);
    expect(
      screen.getByRole('button', { name: 'Start with Twinkle, Twinkle, Little Star' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'First steps' })).toBeChecked();
  });
  it('the red button and a row open their piece', async () => {
    render(<LibraryView />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Start with Twinkle, Twinkle, Little Star' }),
    );
    expect(useAppStore.getState().view).toEqual({
      name: 'score',
      source: { kind: 'library', slug: 'twinkle-twinkle-little-star' },
    });
  });
});

// Kept from M4 and the polish plan (behaviour the UI batch does not change): leaving the list
// clears a stale notice and remembers the scroll, however the reader leaves.
describe('LibraryView: leaving the list (M4, polish plan)', () => {
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
      screen.getByLabelText('Open your own score'),
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

describe('LibraryView: search (spec 6.3, 7.4, 7.5)', () => {
  it('puts the field after the red button, in reading and tab order', () => {
    render(<LibraryView />);
    const start = screen.getByRole('button', { name: /^Start with/ });
    const field = screen.getByRole('searchbox', { name: 'Search the library' });
    expect(field).toHaveAttribute('placeholder', 'Search pieces and composers');
    expect(start.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear the search' })).toBeNull();
  });
  it('searches every level; the pills and the line leave; Clear brings back the chosen level', async () => {
    useAppStore.setState({ libraryLevel: 2 });
    const { container } = render(<LibraryView />);
    await userEvent.type(screen.getByRole('searchbox'), 'minuet');
    expect(screen.queryByRole('group', { name: 'Level' })).toBeNull();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Easy',
      'Moderate',
      'Intermediate',
    ]);
    expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(14);
    expect(container.querySelectorAll('.is-red')).toHaveLength(1);
    await waitFor(
      () => expect(screen.getByTestId('library-announcement')).toHaveTextContent('14 pieces'),
      { timeout: 2000 },
    );
    await userEvent.click(screen.getByRole('button', { name: 'Clear the search' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getByRole('searchbox')).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'Easy' })).toBeChecked();
  });
  it('Escape empties the field and brings back the chosen level', async () => {
    render(<LibraryView />);
    await userEvent.type(screen.getByRole('searchbox'), 'FÜR eli');
    expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(1);
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getByRole('radio', { name: 'First steps' })).toBeChecked();
  });
  it('says when nothing matches', async () => {
    render(<LibraryView />);
    await userEvent.type(screen.getByRole('searchbox'), 'fur elize');
    expect(screen.getByText('No piece matches “fur elize”.')).toBeInTheDocument();
    expect(screen.getByText('Search looks in titles, composers and collections.')).toHaveClass(
      'muted',
    );
    await waitFor(
      () =>
        expect(screen.getByTestId('library-announcement')).toHaveTextContent(
          'No piece matches “fur elize”.',
        ),
      { timeout: 2000 },
    );
  });
  it('keeps the search for the visit', async () => {
    render(<LibraryView />);
    await userEvent.type(screen.getByRole('searchbox'), 'bach');
    expect(useAppStore.getState().libraryQuery).toBe('bach');
  });
});
