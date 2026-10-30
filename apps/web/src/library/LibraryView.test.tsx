import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useLayoutEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore } from '../app/store.js';
import { en } from '../i18n/en/index.js';
import { chooseLocale, resetLocaleForTests } from '../i18n/i18n.js';
import { resetPianoForTests } from '../midi/piano.js';
import { FINGER_LEGEND } from '../score/FingerLegend.js';
import type * as ScoreDocumentModule from '../score/useScoreDocument.js';
import type * as ManifestModule from './manifest.js';
import { SHELVES, shelfOfGenre, tierOf, TIERS, type ShelfId, type Tier } from './levels.js';
import { libraryPieces } from './manifest.js';
import { LibraryView } from './LibraryView.js';
import { useLocalLibrary } from './local/state.js';

// These layout pins describe the 303 curated pieces unless a test asks for the whole library
// (3,245 pieces with the MuseScore archive, collection ids pdmx-*, counted in model.test.ts).
const library = vi.hoisted(() => ({ whole: false, limit: null as number | null }));
vi.mock('./manifest.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ManifestModule>();
  return {
    ...actual,
    libraryPieces: () => {
      const all = library.whole
        ? actual.libraryPieces()
        : actual.libraryPieces().filter((p) => !p.collectionId.startsWith('pdmx-'));
      return library.limit === null ? all : all.slice(0, library.limit);
    },
  };
});

const warmUp = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../score/useScoreDocument.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ScoreDocumentModule>();
  return {
    ...actual,
    warmUpServices: () => {
      warmUp.calls++;
    },
  };
});

beforeEach(() => {
  library.whole = false;
  library.limit = null;
  warmUp.calls = 0;
  useAppStore.setState({
    view: { name: 'library' },
    settings: { ...DEFAULT_SETTINGS },
    notice: null,
    libraryScrollY: 0,
    libraryLevel: null,
    libraryQuery: '',
    libraryShelf: null,
    librarySection: null,
    libraryPages: 1,
    libraryLength: 'any',
    libraryFavouritesOpen: false,
    libraryDeal: 0,
  });
});
// Testing Library only cleans up automatically when vitest globals are on; they are off here.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const rows = () => screen.getAllByRole('button', { name: /^Open / });
const h2s = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
const shelfOf = (name: string) =>
  screen.getByRole('heading', { level: 2, name }).closest('section')!;

describe('LibraryView: import request lifetime', () => {
  function pendingFile(name = 'delayed.musicxml') {
    let resolve!: (bytes: ArrayBuffer) => void;
    let reject!: (error: Error) => void;
    const file = new File(['score'], name);
    vi.spyOn(file, 'arrayBuffer').mockReturnValue(
      new Promise<ArrayBuffer>((yes, no) => {
        resolve = yes;
        reject = no;
      }),
    );
    return { file, resolve, reject };
  }
  function choose(file: File) {
    fireEvent.change(screen.getByLabelText('Open your own score'), { target: { files: [file] } });
  }
  async function finish(pending: ReturnType<typeof pendingFile>, fail = false) {
    await act(async () => {
      if (fail) pending.reject(new Error('gone'));
      else pending.resolve(new ArrayBuffer(1));
    });
  }
  it('keeps About after a pending score read completes', async () => {
    render(<LibraryView />);
    const pending = pendingFile();
    choose(pending.file);
    fireEvent.click(screen.getByRole('button', { name: 'About and licences' }));
    await finish(pending);
    expect(useAppStore.getState().view.name).toBe('about');
  });
  it('invalidates a read even when navigation leaves and returns before React commits', async () => {
    render(<LibraryView />);
    const pending = pendingFile();
    choose(pending.file);
    act(() => {
      useAppStore.getState().openAbout();
      useAppStore.getState().openLibrary();
    });
    await finish(pending);
    expect(useAppStore.getState().view.name).toBe('library');
  });
  it('shares the newest request between the chooser and window drop', async () => {
    render(<LibraryView />);
    const old = pendingFile('old.musicxml');
    const latest = pendingFile('latest.musicxml');
    choose(old.file);
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', {
      value: { types: ['Files'], files: [latest.file] },
    });
    act(() => void window.dispatchEvent(drop));
    await finish(latest);
    await finish(old);
    expect(useAppStore.getState().view).toMatchObject({
      name: 'score',
      source: { name: 'latest.musicxml' },
    });
  });
  it('cancels the older request when the new request starts, before either read completes', async () => {
    render(<LibraryView />);
    const old = pendingFile('old.musicxml');
    const latest = pendingFile('latest.musicxml');
    choose(old.file);
    choose(latest.file);
    await finish(old);
    expect(useAppStore.getState().view.name).toBe('library');
    await finish(latest);
    expect(useAppStore.getState().view).toMatchObject({
      name: 'score',
      source: { name: 'latest.musicxml' },
    });
  });
  it('ignores a stale refusal after a newer selection and after unmount', async () => {
    const { unmount } = render(<LibraryView />);
    const old = pendingFile();
    choose(old.file);
    const later = pendingFile('later.musicxml');
    choose(later.file);
    await finish(old, true);
    expect(useAppStore.getState().notice).toBeNull();
    unmount();
    await finish(later);
    expect(useAppStore.getState().view.name).toBe('library');
  });
  it('shows the loader at once when a file is chosen, and hides the rest of the page', async () => {
    const { container } = render(<LibraryView />);
    const pending = pendingFile();
    choose(pending.file);
    expect(useAppStore.getState().opening).toBe('chosen');
    expect(container.querySelector('main.library > .opening')).not.toBeNull();
    // The page stays in place under the loader (it is hidden by the stylesheet, not removed).
    expect(container.querySelector('main.library')).toHaveClass('is-opening');
    expect(container.querySelectorAll('.loader-red')).toHaveLength(1);
    await finish(pending);
    expect(useAppStore.getState().view.name).toBe('score');
    expect(useAppStore.getState().opening).toBeNull();
  });
  it('gives the library back with a notice when the read never finishes', async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<LibraryView />);
      const pending = pendingFile();
      choose(pending.file);
      expect(container.querySelector('main.library')).toHaveClass('is-opening');
      act(() => void vi.advanceTimersByTime(7999));
      expect(useAppStore.getState().opening).toBe('chosen');
      act(() => void vi.advanceTimersByTime(1));
      expect(useAppStore.getState().opening).toBeNull();
      expect(container.querySelector('.opening')).toBeNull();
      expect(container.querySelector('main.library')).not.toHaveClass('is-opening');
      const notice = useAppStore.getState().notice;
      expect(typeof notice === 'function' ? notice(en) : notice).toBe('Could not read this file.');
      // What the read delivers after the exit is ignored.
      await finish(pending);
      expect(useAppStore.getState().view.name).toBe('library');
    } finally {
      vi.useRealTimers();
    }
  });
  it('brings Start back with the notice when the read fails', async () => {
    const { container } = render(<LibraryView />);
    const pending = pendingFile();
    choose(pending.file);
    await finish(pending, true);
    expect(useAppStore.getState().opening).toBeNull();
    expect(useAppStore.getState().notice).not.toBeNull();
    expect(container.querySelector('.opening')).toBeNull();
    expect(container.querySelector('main.library')).not.toHaveClass('is-opening');
    expect(screen.getByRole('button', { name: /^Start with / })).toBeInTheDocument();
  });
  it('shows no loader after About and back, and the late read has no effect', async () => {
    const { container } = render(<LibraryView />);
    const pending = pendingFile();
    choose(pending.file);
    fireEvent.click(screen.getByRole('button', { name: 'About and licences' }));
    expect(useAppStore.getState().opening).toBeNull();
    act(() => useAppStore.getState().openLibrary());
    expect(container.querySelector('.opening')).toBeNull();
    expect(screen.getByRole('button', { name: /^Start with / })).toBeInTheDocument();
    await finish(pending);
    expect(useAppStore.getState().view.name).toBe('library');
    expect(useAppStore.getState().opening).toBeNull();
  });
  it('gives a file chosen a record id of its own, for the address to name', async () => {
    render(<LibraryView />);
    const pending = pendingFile();
    choose(pending.file);
    await finish(pending);
    const view = useAppStore.getState().view;
    expect(view).toMatchObject({
      name: 'score',
      source: { kind: 'file', name: 'delayed.musicxml' },
    });
    const source = (view as Extract<typeof view, { name: 'score' }>).source;
    expect(source.kind === 'file' && source.localId).toMatch(/^[0-9a-f-]{36}$/);
  });
  it.each([false, true])(
    'ignores delayed scan validation (rejected: %s) after navigation',
    async (invalid) => {
      render(<LibraryView />);
      const pending = pendingFile('page.png');
      vi.spyOn(pending.file, 'slice').mockReturnValue(pending.file);
      choose(pending.file);
      act(() => useAppStore.getState().openAbout());
      await act(async () =>
        pending.resolve(new Uint8Array(invalid ? [0] : [137, 80, 78, 71, 13, 10, 26, 10]).buffer),
      );
      expect(useAppStore.getState().view.name).toBe('about');
      expect(useAppStore.getState().notice).toBeNull();
    },
  );
  it('ignores a delayed image batch after leaving and returning', async () => {
    render(<LibraryView />);
    const pages = [pendingFile('first.png'), pendingFile('second.png')];
    for (const page of pages) vi.spyOn(page.file, 'slice').mockReturnValue(page.file);
    fireEvent.change(screen.getByLabelText('Open your own score'), {
      target: { files: pages.map((page) => page.file) },
    });
    act(() => {
      useAppStore.getState().openAbout();
      useAppStore.getState().openLibrary();
    });
    await act(async () => {
      for (const page of pages)
        page.resolve(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer);
    });
    expect(useAppStore.getState().view.name).toBe('library');
  });
});

describe('LibraryView: the units (shelves spec 4.1, 5)', () => {
  it('is the name, the sentence, one red button, the level pills and the shelves of Easy', () => {
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
    expect(h2s()).toEqual(['Songs', 'Classical', 'Folk and carols', 'Baroque', 'Romantic']);
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
  });
  it('puts the own-score line in the welcome, under Start, before the levels and the list', () => {
    const { container } = render(<LibraryView />);
    const welcome = container.querySelector('header.welcome')!;
    const label = screen.getByText('Open your own score');
    expect(welcome.contains(label)).toBe(true);
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(welcome.querySelector('.start-row')!, label)).toBe(true);
    expect(follows(label, container.querySelector('.level-choice')!)).toBe(true);
    expect(follows(label, container.querySelector('.library-list')!)).toBe(true);
    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(1);
  });
  it('ends the page with the piano line where the browser has Web MIDI', () => {
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      value: () => Promise.resolve(),
      configurable: true,
      writable: true,
    });
    Object.defineProperty(navigator, 'permissions', {
      value: { query: () => Promise.resolve({ state: 'prompt' }) },
      configurable: true,
      writable: true,
    });
    resetPianoForTests();
    try {
      const { container } = render(<LibraryView />);
      const line = container.querySelector('.piano-line')!;
      expect(line).not.toBeNull();
      expect(container.querySelector('header.welcome')!.contains(line)).toBe(false);
      expect(
        Boolean(container.querySelector('.library-list')!.compareDocumentPosition(line) & 4),
      ).toBe(true);
    } finally {
      delete (navigator as unknown as Record<string, unknown>).requestMIDIAccess;
      delete (navigator as unknown as Record<string, unknown>).permissions;
      resetPianoForTests();
    }
  });
  it('shows a shelf as its name, count, line, at most 5 rows and an All button', () => {
    render(<LibraryView />);
    const songs = shelfOf('Songs');
    expect(within(songs).getByText('42 pieces')).toHaveClass('muted');
    expect(
      within(songs).getByText("Well-known tunes from children's songs to film and games."),
    ).toHaveClass('muted');
    expect(within(songs).getAllByRole('button', { name: /^Open / })).toHaveLength(5);
    expect(within(songs).getByRole('button', { name: 'All 42 songs' })).toBeInTheDocument();
    const baroque = shelfOf('Baroque');
    expect(within(baroque).getAllByRole('button', { name: /^Open / })).toHaveLength(5);
    expect(within(baroque).queryByRole('button', { name: /^All / })).toBeNull();
  });
  it('puts at most 30 rows on the arrival page, in every level', async () => {
    render(<LibraryView />);
    for (const name of ['Easy', 'Medium', 'Harder', 'Challenging']) {
      await userEvent.click(screen.getByRole('radio', { name }));
      expect(rows().length, name).toBeLessThanOrEqual(30);
      expect(screen.getAllByRole('heading', { level: 2 }).length, name).toBeLessThanOrEqual(6);
    }
    expect(screen.queryByRole('group', { name: 'Length' })).toBeNull();
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
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, lastPlayed: 'twinkle-twinkle-little-star' },
    });
    render(<LibraryView />);
    const twinkle = screen.getByRole('button', {
      name: 'Open Twinkle, Twinkle, Little Star by Traditional',
    });
    expect(twinkle).toHaveTextContent('Twinkle, Twinkle, Little Star0:29');
    expect(twinkle).toHaveAccessibleDescription('0:29');
    expect(within(shelfOf('Songs')).getAllByRole('button', { name: /^Open / })[0]).toBe(twinkle);
    expect(twinkle).not.toHaveClass('is-red'); // the Continue button is the red one
  });
});

describe('LibraryView: the level pills (shelves spec 3, 7)', () => {
  it('is a radio group named Level with Easy, Medium, Harder and Challenging', () => {
    const { container } = render(<LibraryView />);
    const group = screen.getByRole('group', { name: 'Level' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.closest('label')!.textContent)).toEqual([
      'Easy',
      'Medium',
      'Harder',
      'Challenging',
    ]);
    expect(within(group).getByRole('radio', { name: 'Easy' })).toBeChecked();
    expect(group.querySelectorAll('.is-red')).toHaveLength(0);
    expect(container.querySelectorAll('.pill')).toHaveLength(4);
  });
  it('choosing Medium shows its shelves and says the count once', async () => {
    render(<LibraryView />);
    await userEvent.click(screen.getByRole('radio', { name: 'Medium' }));
    expect(screen.getByRole('radio', { name: 'Medium' })).toBeChecked();
    expect(h2s()).toEqual(['Songs', 'Classical', 'Baroque', 'Romantic']);
    expect(useAppStore.getState().libraryLevel).toBe('medium');
    await waitFor(() =>
      expect(screen.getByTestId('library-announcement')).toHaveTextContent('Medium: 95 pieces'),
    );
  });
  it('says nothing on arrival', async () => {
    render(<LibraryView />);
    await new Promise((r) => setTimeout(r, 700));
    expect(screen.getByTestId('library-announcement')).toHaveTextContent('');
  });
  it('opens on the level chosen earlier in this visit', () => {
    useAppStore.setState({ libraryLevel: 'challenging' });
    render(<LibraryView />);
    expect(screen.getByRole('radio', { name: 'Challenging' })).toBeChecked();
  });
});

describe('LibraryView: a shelf opened (shelves spec 4.2)', () => {
  const open = async (name: RegExp | string) =>
    userEvent.click(screen.getByRole('button', { name }));
  it('replaces the shelves with that one shelf: All styles, its name and count, its rows by collection', async () => {
    render(<LibraryView />);
    await open('All 42 songs');
    expect(h2s()).toEqual(['Songs']);
    expect(screen.getByRole('button', { name: 'All styles' })).toBeInTheDocument();
    expect(screen.getByText('42 pieces')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Easy' })).toBeChecked(); // the pills stay
    expect(screen.getAllByRole('heading', { level: 3 }).length).toBeGreaterThan(0);
    // 42 pieces: one page of 40 and the last 2
    expect(rows()).toHaveLength(40);
    expect(screen.getByRole('button', { name: 'Show the last 2' })).toBeInTheDocument();
    expect(useAppStore.getState().libraryShelf).toBe('songs');
  });
  it('moves the focus to the shelf heading, which is no tab stop', async () => {
    render(<LibraryView />);
    await open('All 42 songs');
    expect(screen.getByRole('heading', { level: 2, name: 'Songs' })).toHaveFocus();
    expect(screen.getByRole('heading', { level: 2, name: 'Songs' })).toHaveAttribute(
      'tabindex',
      '-1',
    );
  });
  it('shows the next page on Show more, focuses its first row and says so once', async () => {
    library.whole = true; // Challenging classical holds 250 pieces: pages of 40 and a last page of 10
    useAppStore.setState({ libraryLevel: 'challenging' });
    render(<LibraryView />);
    await open(/^All 250 classical pieces$/);
    expect(rows()).toHaveLength(40);
    await open('Show 40 more');
    expect(rows()).toHaveLength(80);
    expect(rows()[40]).toHaveFocus();
    expect(useAppStore.getState().libraryPages).toBe(2);
    await waitFor(() =>
      expect(screen.getByTestId('library-announcement')).toHaveTextContent('Showing 80 of 250'),
    );
    await open('Show 40 more');
    await open('Show 40 more');
    await open('Show 40 more');
    await open('Show 40 more');
    await open('Show the last 10');
    expect(rows()).toHaveLength(250);
    expect(screen.queryByRole('button', { name: /^Show (\d+ more|the last \d+)$/ })).toBeNull();
  });
  it('goes back with All styles, focusing the shelf’s All button, and with Escape', async () => {
    render(<LibraryView />);
    await open('All 42 songs');
    await open('All styles');
    expect(h2s()).toEqual(['Songs', 'Classical', 'Folk and carols', 'Baroque', 'Romantic']);
    expect(screen.getByRole('button', { name: 'All 42 songs' })).toHaveFocus();
    expect(useAppStore.getState().libraryShelf).toBeNull();
    await open('All 42 songs');
    await userEvent.keyboard('{Escape}');
    expect(h2s()).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'All 42 songs' })).toHaveFocus();
  });
  it('focuses the All button after Escape that lands between a later render and its effects', async () => {
    // The shared shelf is asked for once the browser is idle: that render is not urgent, so React
    // commits it, yields for a paint and runs its effects in a later task. An Escape pressed in
    // between makes React run those effects first, while the open shelf is still drawn. (happy-dom
    // has no requestIdleCallback: its 200 ms stand-in timer did this to the test above under load.)
    const idle: Array<() => void> = [];
    vi.stubGlobal('requestIdleCallback', (callback: () => void) => idle.push(callback));
    vi.stubGlobal('cancelIdleCallback', () => {});
    // Renders in the same commit as the library and says when that commit's effects have run.
    const commit = { bump: (_: number) => {}, drawn: 0, settled: 0 };
    function Commit() {
      const [n, setN] = useState(0);
      commit.bump = setN;
      useLayoutEffect(() => void (commit.drawn = n));
      useEffect(() => void (commit.settled = n));
      return null;
    }
    render(
      <>
        <LibraryView />
        <Commit />
      </>,
    );
    await open('All 42 songs');
    const actEnvironment = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', false); // React's own scheduler, as in a browser
    try {
      commit.bump(1);
      idle.forEach((callback) => callback());
      for (let task = 0; task < 100 && commit.drawn === 0; task++)
        await new Promise((resolve) => setImmediate(resolve));
      expect(commit).toMatchObject({ drawn: 1, settled: 0 });
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      await waitFor(() => expect(h2s()).toHaveLength(5));
    } finally {
      Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', actEnvironment);
    }
    expect(screen.getByRole('button', { name: 'All 42 songs' })).toHaveFocus();
  });
  it('closes a shelf that has no All button on this level onto its first row, and leaves the focus alone after', async () => {
    // A shelf with more than 5 pieces on one level and 1 to 5 on another: it stays open across
    // the change, and closing it there draws no All button to land on.
    const counts = new Map<string, number>();
    for (const p of libraryPieces()) {
      const key = `${tierOf(p.level)}|${shelfOfGenre(p.genre)}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const count = (tier: Tier, shelf: ShelfId) => counts.get(`${tier}|${shelf}`) ?? 0;
    const cases = SHELVES.flatMap(({ id: shelf }) =>
      TIERS.flatMap((big) =>
        TIERS.filter((small) => count(big, shelf) > 5 && count(small, shelf) > 0)
          .filter((small) => count(small, shelf) <= 5)
          .map((small) => ({ shelf, big, small })),
      ),
    );
    const { shelf, big, small } = cases[0]!;
    useAppStore.setState({ libraryLevel: big });
    const { container } = render(<LibraryView />);
    await userEvent.click(container.querySelector<HTMLElement>(`[data-shelf-all="${shelf}"]`)!);
    await userEvent.click(screen.getByRole('radio', { name: en.library.tiers[small] }));
    expect(useAppStore.getState().libraryShelf).toBe(shelf);
    await userEvent.keyboard('{Escape}');
    expect(useAppStore.getState().libraryShelf).toBeNull();
    const closed = container.querySelector(`[aria-labelledby="shelf-${shelf}"]`)!;
    expect(closed.querySelector('[data-shelf-all]')).toBeNull();
    expect(closed.querySelector('.piece-row')).toHaveFocus();
    // Back on the first level, the shelf's All button is drawn again and must not take the focus.
    await userEvent.click(screen.getByRole('radio', { name: en.library.tiers[big] }));
    expect(container.querySelector(`[data-shelf-all="${shelf}"]`)).not.toBeNull();
    expect(screen.getByRole('radio', { name: en.library.tiers[big] })).toHaveFocus();
  });
  it('keeps the shelf open on a level that has it, and returns to the shelves on one that has not', async () => {
    useAppStore.setState({ libraryLevel: 'challenging' });
    render(<LibraryView />);
    await open(/^All 7 jazz, ragtime and modern pieces$/);
    expect(h2s()).toEqual(['Jazz, ragtime and modern']);
    await userEvent.click(screen.getByRole('radio', { name: 'Easy' })); // Easy has no jazz
    expect(h2s()).toEqual(['Songs', 'Classical', 'Folk and carols', 'Baroque', 'Romantic']);
    expect(useAppStore.getState().libraryShelf).toBeNull();
    await open('All 42 songs');
    await userEvent.click(screen.getByRole('radio', { name: 'Medium' })); // Medium has songs
    expect(h2s()).toEqual(['Songs']);
    expect(screen.getByText('32 pieces')).toBeInTheDocument();
    expect(useAppStore.getState().libraryShelf).toBe('songs');
  });
  it('comes back from a score to the same shelf and the same pages', async () => {
    library.whole = true;
    useAppStore.setState({
      libraryLevel: 'challenging',
      libraryShelf: 'classical',
      libraryPages: 2,
    });
    render(<LibraryView />);
    expect(h2s()).toEqual(['Classical']);
    expect(rows()).toHaveLength(80);
    await userEvent.click(rows()[0]!);
    expect(useAppStore.getState()).toMatchObject({ libraryShelf: 'classical', libraryPages: 2 });
  });
  it('announces the shelf and its count', async () => {
    render(<LibraryView />);
    await open('All 42 songs');
    await waitFor(() =>
      expect(screen.getByTestId('library-announcement')).toHaveTextContent('Songs: 42 pieces'),
    );
  });
});

describe('LibraryView: the length pills (shelves spec 4.3)', () => {
  it('appear above a shelf of more than 40 pieces and not on a shorter one', async () => {
    library.whole = true;
    useAppStore.setState({ libraryLevel: 'challenging', libraryShelf: 'classical' });
    render(<LibraryView />);
    const group = screen.getByRole('group', { name: 'Length' });
    const labels = within(group)
      .getAllByRole('radio')
      .map((r) => r.closest('label')!.textContent);
    expect(labels[0]).toBe('Any length');
    expect(within(group).getByRole('radio', { name: 'Any length' })).toBeChecked();
    expect(group.querySelectorAll('.is-red')).toHaveLength(0);
    cleanup();
    useAppStore.setState({ libraryLevel: 'challenging', libraryShelf: 'romantic' }); // 23 pieces
    render(<LibraryView />);
    expect(screen.queryByRole('group', { name: 'Length' })).toBeNull();
  });
  it('filter the list; the choice outlives the shelf and resets when a shorter list is shown', async () => {
    library.whole = true;
    useAppStore.setState({ libraryLevel: 'challenging', libraryShelf: 'classical' });
    render(<LibraryView />);
    const group = screen.getByRole('group', { name: 'Length' });
    const pills = within(group).getAllByRole('radio');
    expect(pills.length).toBeGreaterThanOrEqual(2);
    const other = pills[1]!;
    const before = rows().length;
    await userEvent.click(other);
    expect(useAppStore.getState().libraryLength).not.toBe('any');
    expect(rows().length).toBeLessThan(before);
    // a short list (37 pieces) cannot filter silently: the choice is dropped
    await userEvent.click(screen.getByRole('button', { name: 'All styles' }));
    await userEvent.click(screen.getByRole('button', { name: /^All 37 jazz/ }));
    expect(screen.queryByRole('group', { name: 'Length' })).toBeNull();
    expect(rows()).toHaveLength(37);
    await waitFor(() => expect(useAppStore.getState().libraryLength).toBe('any'));
  });
});

describe('LibraryView: the Favourites shelf (issue #78)', () => {
  // Curated Easy pieces, in manifest order; the store keeps favourites newest first.
  const easy = () => libraryPieces().filter((p) => p.level <= 2);
  const favour = (n: number) => {
    const chosen = easy().slice(0, n);
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, favourites: chosen.map((p) => p.slug) },
    });
    return chosen;
  };
  const favourites = () =>
    screen.queryByRole('heading', { level: 2, name: 'Favourites' })?.closest('section') ?? null;
  const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  it('is not there before the first favourite', () => {
    render(<LibraryView />);
    expect(favourites()).toBeNull();
  });
  it('stands above the levels with its count and the favourites newest first, and opens one', async () => {
    const chosen = favour(3);
    const { container } = render(<LibraryView />);
    const shelf = favourites()!;
    expect(h2s()[0]).toBe('Favourites');
    expect(
      shelf.compareDocumentPosition(screen.getByRole('radio', { name: 'Easy' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(shelf).getByText('3 pieces')).toHaveClass('muted');
    const titles = within(shelf)
      .getAllByRole('button', { name: /^Open / })
      .map((b) => b.querySelector('.title')!.textContent);
    expect(titles).toEqual(chosen.map((p) => p.title));
    expect(within(shelf).queryByRole('button', { name: /^All / })).toBeNull();
    expect(container.querySelectorAll('.is-red')).toHaveLength(1);
    await userEvent.click(within(shelf).getAllByRole('button', { name: /^Open / })[1]!);
    expect(useAppStore.getState().view).toEqual({
      name: 'score',
      source: { kind: 'library', slug: chosen[1]!.slug },
    });
  });
  it('shows the newest five, and the rest in place on All, focusing the first new row', async () => {
    favour(7);
    render(<LibraryView />);
    const open = () => within(favourites()!).getAllByRole('button', { name: /^Open / });
    expect(open()).toHaveLength(5);
    await userEvent.click(screen.getByRole('button', { name: 'All 7 favourites' }));
    expect(open()).toHaveLength(7);
    expect(open()[5]).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'All 7 favourites' })).toBeNull();
    expect(useAppStore.getState().libraryFavouritesOpen).toBe(true);
  });
  it('leaves while a search or a style shelf is open, as the shelves do', async () => {
    favour(2);
    render(<LibraryView />);
    await userEvent.click(screen.getByRole('button', { name: 'All 42 songs' }));
    expect(favourites()).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'All styles' }));
    expect(favourites()).not.toBeNull();
    await userEvent.type(screen.getByRole('searchbox'), 'minuet');
    expect(favourites()).toBeNull();
  });
  it('says what it holds in one gray line', () => {
    favour(1);
    render(<LibraryView />);
    expect(
      within(favourites()!).getByText('The pieces you marked with the heart, newest first.'),
    ).toHaveClass('muted');
  });
  it('takes a favourite off with its filled heart, keeping the focus on the next one', async () => {
    const chosen = favour(3);
    render(<LibraryView />);
    const remove = (title: string) =>
      screen.getByRole('button', {
        name: new RegExp(`^Remove ${escaped(title)} by .+ from Favourites$`),
      });
    const hearts = () =>
      within(favourites()!).getAllByRole('button', { name: /^Remove .* from Favourites$/ });
    expect(hearts()).toHaveLength(3);
    await userEvent.click(remove(chosen[0]!.title));
    expect(useAppStore.getState().settings.favourites).toEqual(chosen.slice(1).map((p) => p.slug));
    expect(within(favourites()!).getByText('2 pieces')).toBeInTheDocument();
    expect(hearts()[0]).toHaveFocus(); // the next favourite's heart, now the first
    await userEvent.click(remove(chosen[2]!.title));
    expect(hearts()).toHaveLength(1);
    expect(hearts()[0]).toHaveFocus(); // the last one gone: the one before it
    await userEvent.click(remove(chosen[1]!.title));
    expect(favourites()).toBeNull();
    expect(useAppStore.getState().settings.favourites).toEqual([]);
    expect(screen.getByRole('radio', { name: 'Easy' })).toHaveFocus(); // the next unit's control
  });
  it('removes one of a shelf shown in full, which stays in full', async () => {
    const chosen = favour(7);
    useAppStore.setState({ libraryFavouritesOpen: true });
    render(<LibraryView />);
    await userEvent.click(
      screen.getByRole('button', {
        name: new RegExp(`^Remove ${escaped(chosen[6]!.title)} by .+ from Favourites$`),
      }),
    );
    expect(within(favourites()!).getAllByRole('button', { name: /^Open / })).toHaveLength(6);
  });
  it('skips a favourite the library no longer holds', () => {
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, favourites: ['no-such-piece', easy()[0]!.slug] },
    });
    render(<LibraryView />);
    expect(within(favourites()!).getByText('1 piece')).toBeInTheDocument();
    expect(within(favourites()!).getAllByRole('button', { name: /^Open / })).toHaveLength(1);
  });
  it('gives a favourite that is also a shelf sample ids of its own', () => {
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, favourites: easy().map((p) => p.slug) },
      libraryFavouritesOpen: true,
    });
    const { container } = render(<LibraryView />);
    const ids = [...container.querySelectorAll('[id]')].map((e) => e.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('LibraryView: the returning reader (UI batch spec 16)', () => {
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
  it('a lastPlayed slug that is gone falls back to Start and Easy', () => {
    useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, lastPlayed: 'no-such-piece' } });
    render(<LibraryView />);
    expect(
      screen.getByRole('button', { name: 'Start with Twinkle, Twinkle, Little Star' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Easy' })).toBeChecked();
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
    await userEvent.click(rows()[0]!);
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
    await userEvent.click(rows()[0]!);
    expect(useAppStore.getState().libraryScrollY).toBe(1200);
    // This unit renders LibraryView alone; emulate returning before using its next control.
    act(() => useAppStore.getState().openLibrary());
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
    act(() => useAppStore.getState().openLibrary());
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
  describe('when what stands above the list changed meanwhile (a heart pressed on the score)', () => {
    // happy-dom lays nothing out: the list's offset from the page's top is stubbed.
    let listTop = 0;
    beforeEach(() => {
      listTop = 0;
      vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (
        this: HTMLElement,
      ) {
        return this.classList.contains('library-list') ? listTop : 0;
      });
    });
    afterEach(() => vi.restoreAllMocks());
    it('remembers where the list stood when it opens a piece', async () => {
      listTop = 380;
      render(<LibraryView />);
      window.scrollTo({ top: 1200 });
      await userEvent.click(rows()[0]!);
      expect(useAppStore.getState()).toMatchObject({ libraryScrollY: 1200, libraryListTop: 380 });
      window.scrollTo({ top: 0 });
    });
    it('moves the remembered offset by as much as the list moved, before the page scrolls to it', () => {
      useAppStore.setState({ libraryScrollY: 1200, libraryListTop: 380 });
      listTop = 507; // a Favourites shelf of one row now stands above the list
      render(<LibraryView />);
      expect(useAppStore.getState()).toMatchObject({ libraryScrollY: 1327, libraryListTop: 507 });
    });
    it('keeps the top of the page at the top', () => {
      useAppStore.setState({ libraryScrollY: 0, libraryListTop: 380 });
      listTop = 507;
      render(<LibraryView />);
      expect(useAppStore.getState().libraryScrollY).toBe(0);
    });
  });
});

describe('LibraryView: search (UI batch 6.3; shelves spec 4.4)', () => {
  it('puts the field after the red button, in reading and tab order', () => {
    render(<LibraryView />);
    const start = screen.getByRole('button', { name: /^Start with/ });
    const field = screen.getByRole('searchbox', { name: 'Search the library' });
    expect(field).toHaveAttribute('placeholder', 'Search pieces and composers');
    expect(start.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear the search' })).toBeNull();
  });
  it('searches every level in sections; the pills and the line leave; Clear brings back the chosen level', async () => {
    useAppStore.setState({ libraryLevel: 'medium' });
    const { container } = render(<LibraryView />);
    await userEvent.type(screen.getByRole('searchbox'), 'minuet');
    expect(screen.queryByRole('group', { name: 'Level' })).toBeNull();
    expect(h2s()).toEqual(['Easy', 'Medium', 'Harder']);
    // 14 pieces; the one section that holds more than 7 shows 7 and an All button
    expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(13);
    expect(container.querySelectorAll('.is-red')).toHaveLength(1);
    await waitFor(() =>
      expect(screen.getByTestId('library-announcement')).toHaveTextContent('14 pieces'),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Clear the search' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getByRole('searchbox')).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'Medium' })).toBeChecked();
  });
  it('Escape empties the field and brings back the chosen level', async () => {
    render(<LibraryView />);
    await userEvent.type(screen.getByRole('searchbox'), 'FÜR eli');
    expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(1);
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getByRole('radio', { name: 'Easy' })).toBeChecked();
  });
  it('says when nothing matches', async () => {
    render(<LibraryView />);
    await userEvent.type(screen.getByRole('searchbox'), 'fur elize');
    expect(screen.getByText('No piece matches “fur elize”.')).toBeInTheDocument();
    expect(screen.getByText('Search looks in titles, composers and collections.')).toHaveClass(
      'muted',
    );
    await waitFor(() =>
      expect(screen.getByTestId('library-announcement')).toHaveTextContent(
        'No piece matches “fur elize”.',
      ),
    );
  });
  it('keeps the search for the visit', async () => {
    render(<LibraryView />);
    await userEvent.type(screen.getByRole('searchbox'), 'bach');
    expect(useAppStore.getState().libraryQuery).toBe('bach');
  });
  it('shows a section’s first 7 rows and opens it to pages of 40 with All {n} in {Level}', async () => {
    library.whole = true;
    render(<LibraryView />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'a' } });
    const medium = screen.getByRole('heading', { level: 2, name: 'Medium' }).closest('section')!;
    expect(within(medium).getAllByRole('button', { name: /^Open / })).toHaveLength(7);
    const all = within(medium).getByRole('button', { name: /^All [\d,]+ in Medium$/ });
    const total = Number(/All ([\d,]+) in/.exec(all.textContent!)![1]!.replace(',', ''));
    expect(total).toBeGreaterThan(40);
    await userEvent.click(all);
    expect(within(medium).getAllByRole('button', { name: /^Open / })).toHaveLength(40);
    expect(within(medium).getAllByRole('button', { name: /^Open / })[7]).toHaveFocus();
    expect(useAppStore.getState().librarySection).toBe('medium');
    await userEvent.click(within(medium).getByRole('button', { name: /^Show / }));
    expect(within(medium).getAllByRole('button', { name: /^Open / }).length).toBeGreaterThan(40);
    expect(useAppStore.getState().libraryPages).toBe(2);
    // typing again closes the section
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ab' } });
    expect(useAppStore.getState().librarySection).toBeNull();
  });
  it('finds a style by its shelf name, and shows the length pills above 40 results', async () => {
    library.whole = true;
    render(<LibraryView />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'baroque' } });
    const total = libraryPieces().filter((p) => shelfOfGenre(p.genre) === 'baroque').length;
    expect(total).toBeGreaterThan(40);
    expect(screen.getByRole('group', { name: 'Length' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Easy',
      'Medium',
      'Harder',
      'Challenging',
    ]);
    expect(screen.getAllByRole('button', { name: /^Open / }).length).toBeLessThanOrEqual(28);
  });
});

describe('LibraryView in another language (issue #6)', () => {
  afterEach(() => {
    resetLocaleForTests();
    useLocalLibrary.setState({ items: [], failed: false });
  });
  it('speaks French: sentence, button, levels, shelves, counts and the own-score line', async () => {
    await act(() => chooseLocale('fr'));
    render(<LibraryView />);
    expect(
      screen.getByText(
        'Les numéros de doigts pour le piano. Choisissez un morceau, appuyez sur Lire et suivez la note rouge.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Commencer avec Twinkle, Twinkle, Little Star' }),
    ).toHaveClass('is-red');
    expect(screen.getByRole('radio', { name: 'Facile' })).toBeChecked();
    expect(h2s()).toEqual([
      'Chansons',
      'Classique',
      'Folklore et chants de Noël',
      'Baroque',
      'Romantique',
    ]);
    const songs = shelfOf('Chansons');
    expect(within(songs).getByText('42 morceaux')).toBeInTheDocument();
    expect(within(songs).getByRole('button', { name: 'Voir les 42 chansons' })).toBeInTheDocument();
    expect(within(songs).getAllByRole('button', { name: /^Ouvrir .+ de .+/ })).toHaveLength(5);
    expect(screen.getByLabelText('Ouvrir votre propre partition')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'À propos et licences' })).toBeInTheDocument();
  });
  it('announces in the language on screen, and finds a shelf by its name there', async () => {
    library.whole = true;
    await act(() => chooseLocale('nl'));
    render(<LibraryView />);
    await userEvent.click(screen.getByRole('radio', { name: 'Gemiddeld' }));
    await waitFor(() =>
      expect(screen.getByTestId('library-announcement')).toHaveTextContent(
        /^Gemiddeld: [\d.]+ stukken$/,
      ),
    );
    await userEvent.type(
      screen.getByRole('searchbox', { name: 'De bibliotheek doorzoeken' }),
      'barok',
    );
    expect(screen.getAllByRole('button', { name: /^Open .+ van .+/ }).length).toBeGreaterThan(0);
    await userEvent.clear(screen.getByRole('searchbox'));
    await userEvent.type(screen.getByRole('searchbox'), 'zzzzqq');
    expect(screen.getByText('Geen stuk gevonden voor “zzzzqq”.')).toBeInTheDocument();
  });
  it('writes the saved scores in Portuguese', async () => {
    await act(() => chooseLocale('pt'));
    useLocalLibrary.setState({
      items: [{ id: 'a', name: 'piano.png', detail: 'draft', saved: true }],
      failed: false,
    });
    render(<LibraryView />);
    expect(screen.getByText('Minhas partituras')).toBeInTheDocument();
    expect(screen.getByText('Salvas')).toBeInTheDocument();
    expect(screen.getByText('Rascunho de digitalização')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remover piano.png (salva)' })).toBeInTheDocument();
  });
});

describe('LibraryView: warming up the score services', () => {
  const idleNow = () => {
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn((callback: () => void) => {
        callback();
        return 1;
      }),
    );
    vi.stubGlobal('cancelIdleCallback', vi.fn());
  };
  it('starts them when the browser is idle and has Workers', () => {
    idleNow();
    vi.stubGlobal('Worker', class {});
    render(<LibraryView />);
    expect(warmUp.calls).toBe(1);
  });
  it('starts nothing where there are no Workers', () => {
    idleNow();
    vi.stubGlobal('Worker', undefined);
    render(<LibraryView />);
    expect(warmUp.calls).toBe(0);
  });
});

describe('LibraryView: the fade of a changed list (UI batch spec 6.4)', () => {
  const list = (container: HTMLElement) => container.querySelector('.library-list')!;
  it('is absent on arrival and appears when another level replaces the shelves', async () => {
    const { container } = render(<LibraryView />);
    expect(list(container)).not.toHaveClass('is-fresh');
    await userEvent.click(screen.getByRole('radio', { name: 'Medium' }));
    expect(list(container)).toHaveClass('is-fresh');
  });
  it('appears when a shelf opens in place of the shelves', async () => {
    const { container } = render(<LibraryView />);
    await userEvent.click(screen.getByRole('button', { name: 'All 42 songs' }));
    expect(list(container)).toHaveClass('is-fresh');
  });
  it('does not appear when a page is appended to a shelf', async () => {
    library.whole = true;
    useAppStore.setState({ libraryLevel: 'challenging', libraryShelf: 'classical' });
    const { container } = render(<LibraryView />);
    await userEvent.click(screen.getByRole('button', { name: 'Show 40 more' }));
    expect(rows()).toHaveLength(80);
    expect(list(container)).not.toHaveClass('is-fresh');
  });
});

describe('LibraryView: dealing the library again (issue 228)', () => {
  afterEach(() => resetLocaleForTests());
  const control = () => screen.getByRole('button', { name: 'Shuffle the shelves' });
  const sampleSlugs = () => rows().map((r) => r.getAttribute('aria-label') ?? r.textContent);
  it('stands after the level pills, outside the list, and is drawn in ink', () => {
    const { container } = render(<LibraryView />);
    const choice = container.querySelector('.level-choice')!;
    expect(choice.contains(control())).toBe(true);
    expect(choice.querySelector('.pills')!.nextElementSibling).toBe(control());
    expect(container.querySelector('.library-list')!.contains(control())).toBe(false);
    expect(control().querySelectorAll('.is-red')).toHaveLength(0);
    expect(control().querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('.is-red')).toHaveLength(1);
  });
  it('is named for a tooltip too', () => {
    render(<LibraryView />);
    expect(control()).toHaveAttribute('title', 'Shuffle the shelves');
  });
  it('stands on the arrival page only: not on an open shelf, in search or in a small library', async () => {
    useAppStore.setState({ libraryShelf: 'songs' });
    render(<LibraryView />);
    expect(screen.getByRole('radio', { name: 'Easy' })).toBeChecked();
    expect(screen.queryByRole('button', { name: 'Shuffle the shelves' })).toBeNull();
    cleanup();
    useAppStore.setState({ libraryShelf: null });
    render(<LibraryView />);
    expect(control()).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox'), 'minuet');
    expect(screen.queryByRole('button', { name: 'Shuffle the shelves' })).toBeNull();
    cleanup();
    library.limit = 30;
    render(<LibraryView />);
    expect(screen.queryByRole('button', { name: 'Shuffle the shelves' })).toBeNull();
  });
  it('draws the samples of every shelf again, keeps the focus and fades the rows in', async () => {
    const { container } = render(<LibraryView />);
    const before = sampleSlugs();
    const list = container.querySelector('.library-list');
    expect(list).not.toHaveClass('is-fresh');
    await userEvent.click(control());
    expect(useAppStore.getState().libraryDeal).toBe(1);
    expect(control()).toHaveFocus();
    expect(sampleSlugs()).not.toEqual(before);
    expect(container.querySelector('.library-list')).toHaveClass('is-fresh');
    expect(container.querySelectorAll('.is-red')).toHaveLength(1);
  });
  it('keeps the same samples for the same deal when the list is drawn again (Back from a score)', async () => {
    const first = render(<LibraryView />);
    await userEvent.click(control());
    await userEvent.click(control());
    const dealt = sampleSlugs();
    first.unmount();
    // Playing one of the dealt pieces makes it the last one played; Back must not draw again.
    const label = dealt[0]!;
    const played = libraryPieces().find((p) => label.startsWith(`Open ${p.title}`))!;
    useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, lastPlayed: played.slug } });
    render(<LibraryView />);
    expect(useAppStore.getState().libraryDeal).toBe(2);
    expect(sampleSlugs()).toEqual(dealt);
  });
  it('lists an opened shelf in the order the deal gave it, after shelves were dealt', async () => {
    library.whole = true;
    useAppStore.setState({ libraryLevel: 'challenging' });
    render(<LibraryView />);
    await userEvent.click(screen.getByRole('button', { name: /^All \d+ classical pieces$/ }));
    const order = sampleSlugs();
    await userEvent.click(screen.getByRole('button', { name: 'All styles' }));
    await userEvent.click(control());
    await userEvent.click(screen.getByRole('button', { name: /^All \d+ classical pieces$/ }));
    expect(sampleSlugs()).not.toEqual(order);
  });
  it('does not swallow the announcements of a shelf opened after a press', async () => {
    library.whole = true;
    useAppStore.setState({ libraryLevel: 'challenging' });
    render(<LibraryView />);
    await userEvent.click(control());
    await userEvent.click(screen.getByRole('button', { name: /^All 250 classical pieces$/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Show 40 more' }));
    await waitFor(() =>
      expect(screen.getByTestId('library-announcement')).toHaveTextContent('Showing 80 of 250'),
    );
  });
  it('says Shelves shuffled once per press, also the second time, and nothing on arrival', async () => {
    render(<LibraryView />);
    const region = screen.getByTestId('library-announcement');
    await new Promise((r) => setTimeout(r, 700));
    expect(region).toHaveTextContent('');
    await userEvent.click(control());
    await waitFor(() => expect(region).toHaveTextContent('Shelves shuffled'));
    const changes: string[] = [];
    const watch = new MutationObserver(() => changes.push(region.textContent ?? ''));
    watch.observe(region, { childList: true, characterData: true, subtree: true });
    await userEvent.click(control());
    await waitFor(() => expect(changes).toContain('Shelves shuffled'));
    expect(changes[0]).toBe('');
    watch.disconnect();
  });
  it('goes back to counting when the reader moves to another level', async () => {
    render(<LibraryView />);
    await userEvent.click(control());
    await userEvent.click(screen.getByRole('radio', { name: 'Medium' }));
    await waitFor(() =>
      expect(screen.getByTestId('library-announcement')).toHaveTextContent('Medium: 95 pieces'),
    );
  });
  it('is named in the language on screen', async () => {
    await act(() => chooseLocale('fr'));
    render(<LibraryView />);
    expect(screen.getByRole('button', { name: 'Mélanger les rayons' })).toBeInTheDocument();
  });
});
