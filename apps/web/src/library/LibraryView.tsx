import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { useFocusOnArrival } from '../app/focus.js';
import { hashToView } from '../app/routes.js';
import { useAppStore, type PieceSource } from '../app/store.js';
import { Button } from '../design/Button.js';
import { ThemeToggle } from '../design/ThemeToggle.js';
import { LanguageLine } from '../i18n/LanguageLine.js';
import { useT } from '../i18n/i18n.js';
import { warmUpServices } from '../score/useScoreDocument.js';
import { SECTION_ROWS, showsSearch } from './disclosure.js';
import { Favourites } from './Favourites.js';
import { LevelPills } from './LevelPills.js';
import { type ShelfId, type Tier } from './levels.js';
import { libraryPieces } from './manifest.js';
import {
  announcementFor,
  arrivalLevel,
  favouritesShelf,
  libraryLayout,
  localDateKey,
  shelfHasPieces,
  startLabel,
  startTarget,
  type Section,
} from './model.js';
import { useWindowFileDrop } from './ownFile.js';
import { DropFrame, OwnFileLine } from './OwnFileLine.js';
import { PieceList } from './PieceList.js';
import { SearchField } from './SearchField.js';
import { MyScores } from './local/MyScores.js';
import './library.css';

/** The announcement waits for the reader to stop changing the list (arrowing through the pills). */
export const ANNOUNCE_DELAY_MS = 500;

/** Where the focus goes once the list has changed: the clicked control is gone or the rows are new. */
type FocusTarget =
  | { kind: 'heading' }
  | { kind: 'shelf-button'; shelf: ShelfId }
  | { kind: 'row'; within: string | null; index: number };

/** True once `key` has differed from its first value: the list fades in on changes, never on arrival. */
function useChanged(key: string): boolean {
  const first = useRef(key);
  const changed = useRef(false);
  if (key !== first.current) changed.current = true;
  return changed.current;
}

/** What the polite live region says: the text, once, a moment after the last change, never on arrival. */
function useAnnouncement(text: string): string {
  const [said, setSaid] = useState('');
  const changed = useChanged(text);
  useEffect(() => {
    if (!changed) return;
    const timer = setTimeout(() => setSaid(text), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, changed]);
  return said;
}

/**
 * Starts the engine worker and compiles the Verovio WASM while the reader looks at the list, so
 * the first piece opens faster. Runs when the browser is idle; nothing happens without Workers.
 */
function useWarmUpWhenIdle() {
  useEffect(() => {
    if (typeof Worker === 'undefined') return;
    if (typeof requestIdleCallback === 'function') {
      const handle = requestIdleCallback(warmUpServices, { timeout: 2000 });
      return () => cancelIdleCallback(handle);
    }
    const timer = setTimeout(warmUpServices, 200);
    return () => clearTimeout(timer);
  }, []);
}

/**
 * Remembers how far the list is scrolled, so the way back to it (the score's Back button or the
 * browser's) lands on the same rows (App.tsx restores `libraryScrollY`). However the reader
 * leaves: a library control (it calls the function this returns before it opens something), or
 * the history (the browser's Forward, an edited address), which no control sees. Where the list
 * stood is remembered with it (`useAnchoredLibraryScroll`).
 *
 * The scroll is followed while the list is mounted and written to the store once, when the list
 * unmounts (not per scroll event: every store write also rewrites the persisted settings). That
 * cleanup runs in the commit that removes the list, before App's layout effect scrolls for the
 * next view and before the next view's shorter page clamps the offset. Only scrolls while the
 * address still names the library count: a step through the history changes the address first
 * and may then restore the next entry's offset on this page before it goes.
 */
function useRememberLibraryScroll(list: RefObject<HTMLElement | null>): () => void {
  const setLibraryScrollY = useAppStore((s) => s.setLibraryScrollY);
  /**
   * The offset to write when the list goes, with where the list stood at that moment; null until
   * the list scrolls or opens something.
   */
  const latest = useRef<{ y: number; top: number | null } | null>(null);
  useLayoutEffect(() => {
    latest.current = null;
    const onScroll = () => {
      if (hashToView(location.hash)?.name === 'library')
        latest.current = { y: window.scrollY, top: listTop(list.current) };
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (latest.current !== null) setLibraryScrollY(latest.current.y, latest.current.top);
    };
  }, [setLibraryScrollY, list]);
  // Stable, so the window's drop listener (useWindowFileDrop) is not added again on every render.
  return useCallback(() => {
    latest.current = { y: window.scrollY, top: listTop(list.current) };
    setLibraryScrollY(latest.current.y, latest.current.top);
  }, [setLibraryScrollY, list]);
}

/** Where the list stands on the page, whatever the scroll; null once it has left the document. */
function listTop(list: HTMLElement | null): number | null {
  return list?.isConnected ? list.offsetTop : null;
}

/**
 * Coming back to the list, moves the remembered offset by as much as the list moved since it was
 * taken, so the reader lands on the same rows when what stands above the list changed meanwhile:
 * a heart pressed on the score adds or removes a favourite, a file opened joins My scores. Runs
 * before App scrolls to the offset (a child's layout effect runs before its parent's). The top of
 * the page stays the top, as the browsers' own scroll anchoring keeps it.
 */
function useAnchoredLibraryScroll(list: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const { libraryScrollY, libraryListTop, setLibraryScrollY } = useAppStore.getState();
    const now = listTop(list.current);
    if (libraryListTop === null || now === null || libraryScrollY <= 0) return;
    if (now !== libraryListTop)
      setLibraryScrollY(Math.max(0, libraryScrollY + now - libraryListTop), now);
  }, [list]);
}

/**
 * Moves the focus once a list change has rendered: to the opened shelf's heading, back to the
 * shelf's `All N` button, or to the first row a page appended. The clicked button is gone by
 * then, and without this the focus falls to <body>. The heading of an opened shelf is also
 * brought to the top of the screen when the reader had scrolled past it.
 */
function useFocusAfterChange(
  list: RefObject<HTMLElement | null>,
  target: RefObject<FocusTarget | null>,
) {
  useEffect(() => {
    const wanted = target.current;
    const root = list.current;
    target.current = null;
    if (!wanted || !root) return;
    if (wanted.kind === 'heading') {
      const top = root.getBoundingClientRect().top;
      if (top < 0) window.scrollBy(0, top);
      root.querySelector<HTMLElement>('#shelf-open')?.focus({ preventScroll: true });
    } else if (wanted.kind === 'shelf-button') {
      root.querySelector<HTMLElement>(`[data-shelf-all="${wanted.shelf}"]`)?.focus();
    } else {
      const scope = wanted.within === null ? root : root.querySelector(wanted.within);
      scope?.querySelectorAll<HTMLElement>('.piece-row')[wanted.index]?.focus();
    }
  });
}

export function LibraryView() {
  const t = useT();
  useWarmUpWhenIdle();
  const openScan = useAppStore((s) => s.openScan);
  const scan = (files: File[]) => {
    rememberScroll();
    setNotice(null);
    openScan({
      id: crypto.randomUUID(),
      file: files[0]!,
      pages: files.map((file) => ({ id: crypto.randomUUID(), file })),
    });
  };
  const openPiece = useAppStore((s) => s.openPiece);
  const openAbout = useAppStore((s) => s.openAbout);
  const setNotice = useAppStore((s) => s.setNotice);
  const lastPlayed = useAppStore((s) => s.settings.lastPlayed);
  const chosenLevel = useAppStore((s) => s.libraryLevel);
  const setLibraryLevel = useAppStore((s) => s.setLibraryLevel);
  const query = useAppStore((s) => s.libraryQuery);
  const setLibraryQuery = useAppStore((s) => s.setLibraryQuery);
  const shelf = useAppStore((s) => s.libraryShelf);
  const setLibraryShelf = useAppStore((s) => s.setLibraryShelf);
  const section = useAppStore((s) => s.librarySection);
  const setLibrarySection = useAppStore((s) => s.setLibrarySection);
  const pages = useAppStore((s) => s.libraryPages);
  const setLibraryPages = useAppStore((s) => s.setLibraryPages);
  const length = useAppStore((s) => s.libraryLength);
  const setLibraryLength = useAppStore((s) => s.setLibraryLength);
  const favourites = useAppStore((s) => s.settings.favourites);
  const favouritesOpen = useAppStore((s) => s.libraryFavouritesOpen);
  const setFavouritesOpen = useAppStore((s) => s.setLibraryFavouritesOpen);
  const heading = useRef<HTMLHeadingElement>(null);
  useFocusOnArrival(heading);
  const list = useRef<HTMLDivElement>(null);
  useAnchoredLibraryScroll(list);
  const rememberScroll = useRememberLibraryScroll(list);
  const pieces = libraryPieces();
  const tier = arrivalLevel(pieces, chosenLevel, lastPlayed);
  // The day is read once per visit to the page: the samples never change while the reader looks.
  const [date] = useState(() => localDateKey());
  const layout = useMemo(
    () =>
      libraryLayout(pieces, { tier, query, shelf, section, pages, length, date, lastPlayed }, t),
    [pieces, tier, query, shelf, section, pages, length, date, lastPlayed, t],
  );
  // On the arrival page only: a search or an opened shelf replaces it, as it replaces the shelves.
  const favouritesInView = useMemo(
    () =>
      layout.kind === 'shelves' || layout.kind === 'all'
        ? favouritesShelf(pieces, favourites, favouritesOpen, t)
        : null,
    [layout.kind, pieces, favourites, favouritesOpen, t],
  );
  const start = startTarget(pieces, lastPlayed);
  // Search results share the key 'search': keystrokes after the first swap the rows without a
  // fade (UI batch spec 6.4). A page appended fades its new rows only (`freshFrom`).
  const listKey =
    layout.kind === 'shelves'
      ? `tier-${layout.tier}`
      : layout.kind === 'shelf'
        ? `shelf-${layout.tier}-${layout.shelf}`
        : layout.kind;
  const fade = useChanged(listKey);
  const announcement = useAnnouncement(announcementFor(layout, t));
  const focusAfter = useRef<FocusTarget | null>(null);
  const [appended, setAppended] = useState<{ key: string; from: number } | null>(null);
  const freshFrom = appended?.key === listKey ? appended.from : null;
  const openShelf = layout.kind === 'shelf' ? layout.shelf : null;
  // A length the list in view cannot honour (its list is 40 pieces or fewer, or holds none of
  // that length) must not filter silently: the choice goes back to Any length (spec 4.3).
  const lengthInEffect =
    layout.kind === 'shelf' || layout.kind === 'search' ? layout.length : length;
  useEffect(() => {
    if (lengthInEffect !== length) setLibraryLength(lengthInEffect);
  }, [lengthInEffect, length, setLibraryLength]);
  useFocusAfterChange(list, focusAfter);
  // A refusal still showing would be stale in the score view, so opening anything clears it.
  const open = (source: PieceSource) => {
    rememberScroll();
    setNotice(null);
    openPiece(source);
  };
  // Stable, so the window's drop listener stays put across renders.
  const openFile = useCallback(
    (name: string, bytes: Uint8Array) => {
      rememberScroll();
      setNotice(null);
      openPiece({ kind: 'file', name, bytes });
    },
    [rememberScroll, setNotice, openPiece],
  );
  const dragging = useWindowFileDrop(openFile, setNotice, scan);
  const about = () => {
    rememberScroll();
    openAbout();
  };
  const chooseTier = (next: Tier) => {
    setLibraryLevel(next);
    // The shelf stays open on a level that has it, else the reader is back at the shelves.
    if (shelf !== null && !shelfHasPieces(pieces, next, shelf)) setLibraryShelf(null);
  };
  const openShelfAt = (id: ShelfId) => {
    focusAfter.current = { kind: 'heading' };
    setLibraryShelf(id);
  };
  // Stable, so the Escape listener is not added again on every render.
  const closeShelf = useCallback(() => {
    if (openShelf === null) return;
    focusAfter.current = { kind: 'shelf-button', shelf: openShelf };
    setLibraryShelf(null);
  }, [openShelf, setLibraryShelf]);
  useEffect(() => {
    if (openShelf === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) closeShelf();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openShelf, closeShelf]);
  const showMore = () => {
    if (layout.kind !== 'shelf') return;
    focusAfter.current = { kind: 'row', within: null, index: layout.shown };
    setAppended({ key: listKey, from: layout.shown });
    setLibraryPages(pages + 1);
  };
  const sectionAction = (s: Section) => {
    focusAfter.current = {
      kind: 'row',
      within: `[data-section="${s.tier}"]`,
      index: s.action?.kind === 'open' ? SECTION_ROWS : s.shown,
    };
    setAppended({ key: listKey, from: s.action?.kind === 'open' ? SECTION_ROWS : s.shown });
    if (s.action?.kind === 'open') setLibrarySection(s.tier);
    else setLibraryPages(pages + 1);
  };
  const listClass = [
    'library-list',
    layout.kind === 'shelves' || layout.kind === 'shelf' ? 'is-level' : '',
    fade ? 'is-fresh' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <main className={dragging ? 'page stack library is-dragging' : 'page stack library'}>
      <header className="welcome">
        <ThemeToggle />
        <h1 ref={heading} tabIndex={-1}>
          digitus2
        </h1>
        <p className="muted">{t.library.welcome.tagline}</p>
        <div className="start-row">
          <Button primary onClick={() => open({ kind: 'library', slug: start.piece.slug })}>
            {startLabel(start, t)}
          </Button>
          {showsSearch(pieces.length) && <SearchField query={query} onChange={setLibraryQuery} />}
        </div>
      </header>
      {favouritesInView && (
        <Favourites
          shelf={favouritesInView}
          onOpen={(slug) => open({ kind: 'library', slug })}
          onAll={() => setFavouritesOpen(true)}
        />
      )}
      <MyScores onOpen={rememberScroll} />
      {(layout.kind === 'shelves' || layout.kind === 'shelf') && (
        <div className="level-choice">
          <LevelPills tiers={layout.tiers} tier={layout.tier} onChange={chooseTier} />
        </div>
      )}
      <div key={listKey} ref={list} className={listClass}>
        {layout.kind === 'search' && layout.count === 0 ? (
          <div className="empty-result">
            <p>{t.library.search.noMatch(layout.query)}</p>
            <p className="muted">{t.library.search.noMatchHint}</p>
          </div>
        ) : (
          <PieceList
            layout={layout}
            freshFrom={freshFrom}
            onOpen={(slug) => open({ kind: 'library', slug })}
            onOpenShelf={openShelfAt}
            onBack={closeShelf}
            onMore={showMore}
            onSection={sectionAction}
            onLength={setLibraryLength}
          />
        )}
      </div>
      <p className="visually-hidden" aria-live="polite" data-testid="library-announcement">
        {announcement}
      </p>
      <OwnFileLine onFile={openFile} onRefuse={setNotice} onScan={scan} />
      <footer className="library-footer">
        <button type="button" className="text-button" onClick={about}>
          {t.library.aboutAndLicences}
        </button>
        <LanguageLine />
      </footer>
      {dragging && <DropFrame />}
    </main>
  );
}
