import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFocusOnArrival } from '../app/focus.js';
import { hashToView } from '../app/routes.js';
import { useAppStore, type PieceSource } from '../app/store.js';
import { Button } from '../design/Button.js';
import { ThemeToggle } from '../design/ThemeToggle.js';
import { warmUpServices } from '../score/useScoreDocument.js';
import { showsSearch } from './disclosure.js';
import { LevelPills } from './LevelPills.js';
import { LEVEL_LINES, LEVEL_NAMES } from './levels.js';
import { pieces } from './manifest.js';
import {
  arrivalLevel,
  countText,
  libraryLayout,
  startLabel,
  startTarget,
  type LibraryLayout,
} from './model.js';
import { useWindowFileDrop } from './ownFile.js';
import { DropFrame, OwnFileLine } from './OwnFileLine.js';
import { PieceList } from './PieceList.js';
import { SearchField } from './SearchField.js';
import { MyScores } from './local/MyScores.js';
import './library.css';

const LEVEL_LINE_ID = 'library-level-line';
/** The announcement waits for the reader to stop changing the list (arrowing through the pills). */
export const ANNOUNCE_DELAY_MS = 500;

function announcementFor(layout: LibraryLayout): string {
  if (layout.kind === 'search')
    return layout.count === 0 ? `No piece matches “${layout.query}”.` : countText(layout.count);
  return layout.kind === 'level' ? `${LEVEL_NAMES[layout.level]}: ${countText(layout.count)}` : '';
}

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
 * the history (the browser's Forward, an edited address), which no control sees.
 *
 * The scroll is followed while the list is mounted and written to the store once, when the list
 * unmounts (not per scroll event: every store write also rewrites the persisted settings). That
 * cleanup runs in the commit that removes the list, before App's layout effect scrolls for the
 * next view and before the next view's shorter page clamps the offset. Only scrolls while the
 * address still names the library count: a step through the history changes the address first
 * and may then restore the next entry's offset on this page before it goes.
 */
function useRememberLibraryScroll(): () => void {
  const setLibraryScrollY = useAppStore((s) => s.setLibraryScrollY);
  /** The offset to write when the list goes; null until the list scrolls or opens something. */
  const latest = useRef<number | null>(null);
  useLayoutEffect(() => {
    latest.current = null;
    const onScroll = () => {
      if (hashToView(location.hash)?.name === 'library') latest.current = window.scrollY;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (latest.current !== null) setLibraryScrollY(latest.current);
    };
  }, [setLibraryScrollY]);
  // Stable, so the window's drop listener (useWindowFileDrop) is not added again on every render.
  return useCallback(() => {
    latest.current = window.scrollY;
    setLibraryScrollY(window.scrollY);
  }, [setLibraryScrollY]);
}

export function LibraryView() {
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
  const heading = useRef<HTMLHeadingElement>(null);
  useFocusOnArrival(heading);
  const rememberScroll = useRememberLibraryScroll();
  const level = arrivalLevel(pieces, chosenLevel, lastPlayed);
  const layout = useMemo(() => libraryLayout(pieces, { level, query }), [level, query]);
  const start = startTarget(pieces, lastPlayed);
  // Every search result list shares the key 'search': keystrokes after the first swap the rows
  // without a fade (spec 6.4).
  const listKey = layout.kind === 'level' ? `level-${layout.level}` : layout.kind;
  const fade = useChanged(listKey);
  const announcement = useAnnouncement(announcementFor(layout));
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
  const listClass = [
    'library-list',
    layout.kind === 'level' ? 'is-level' : '',
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
        <p className="muted">
          Finger numbers for piano. Pick a piece, press play, and follow the red note.
        </p>
        <div className="start-row">
          <Button primary onClick={() => open({ kind: 'library', slug: start.piece.slug })}>
            {startLabel(start)}
          </Button>
          {showsSearch(pieces.length) && <SearchField query={query} onChange={setLibraryQuery} />}
        </div>
      </header>
      <MyScores onOpen={rememberScroll} />
      {layout.kind === 'level' && (
        <div className="level-choice">
          <LevelPills
            levels={layout.levels}
            level={layout.level}
            describedBy={LEVEL_LINE_ID}
            onChange={setLibraryLevel}
          />
          <p id={LEVEL_LINE_ID} className="level-line muted">
            {LEVEL_LINES[layout.level]}
          </p>
        </div>
      )}
      <div key={listKey} className={listClass}>
        {layout.kind === 'search' && layout.count === 0 ? (
          <div className="empty-result">
            <p>No piece matches “{layout.query}”.</p>
            <p className="muted">Search looks in titles, composers and collections.</p>
          </div>
        ) : (
          <PieceList layout={layout} onOpen={(slug) => open({ kind: 'library', slug })} />
        )}
      </div>
      <p className="visually-hidden" aria-live="polite" data-testid="library-announcement">
        {announcement}
      </p>
      <OwnFileLine onFile={openFile} onRefuse={setNotice} onScan={scan} />
      <footer className="library-footer">
        <button type="button" className="text-button" onClick={about}>
          About and licences
        </button>
      </footer>
      {dragging && <DropFrame />}
    </main>
  );
}
