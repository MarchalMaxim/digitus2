import { useEffect, useLayoutEffect, useRef, type MouseEvent } from 'react';
import { useFocusOnArrival } from '../app/focus.js';
import { hashToView } from '../app/routes.js';
import { useAppStore, type PieceSource } from '../app/store.js';
import { Button } from '../design/Button.js';
import { FingerLegend } from '../score/FingerLegend.js';
import { warmUpServices } from '../score/useScoreDocument.js';
import { DropZone } from './DropZone.js';
import {
  formatDuration,
  LEVEL_NAMES,
  pieces,
  recommendedPiece,
  type LibraryPiece,
  type Level,
} from './manifest.js';

/** Pieces grouped by level, levels ascending, pieces in manifest order within a level. */
const piecesByLevel: [Level, LibraryPiece[]][] = (() => {
  const groups = pieces.reduce((acc, p) => {
    const group = acc.get(p.level);
    if (group) group.push(p);
    else acc.set(p.level, [p]);
    return acc;
  }, new Map<Level, LibraryPiece[]>());
  return [...groups.entries()].sort(([a], [b]) => a - b);
})();

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
  return () => {
    latest.current = window.scrollY;
    setLibraryScrollY(window.scrollY);
  };
}

export function LibraryView() {
  useWarmUpWhenIdle();
  const openPiece = useAppStore((s) => s.openPiece);
  const openAbout = useAppStore((s) => s.openAbout);
  const setNotice = useAppStore((s) => s.setNotice);
  const start = recommendedPiece();
  const heading = useRef<HTMLHeadingElement>(null);
  useFocusOnArrival(heading);
  const rememberScroll = useRememberLibraryScroll();
  // A refusal still showing would be stale in the score view, so opening anything clears it.
  const open = (source: PieceSource) => {
    rememberScroll();
    setNotice(null);
    openPiece(source);
  };
  const about = () => {
    rememberScroll();
    openAbout();
  };
  // The drop zone sits after all 30 rows (review L1): the welcome's link brings it into view,
  // at once (motion stays under 200 ms), and puts the focus on its file chooser.
  const dropZone = useRef<HTMLDivElement>(null);
  const chooser = useRef<HTMLInputElement>(null);
  const showDropZone = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    dropZone.current?.scrollIntoView({ block: 'center', behavior: 'instant' });
    chooser.current?.focus({ preventScroll: true });
  };

  return (
    <main className="page stack library">
      <header className="stack welcome">
        <h1 ref={heading} tabIndex={-1}>
          digitus2
        </h1>
        <p className="muted">
          Finger numbers for piano music. Pick a piece, press play, and follow the red note.
        </p>
        <FingerLegend />
        {/* An in-page link. Its address is the library's own: the hash is the router, so an
            anchor to the drop zone would change the view; the click scrolls instead. */}
        <p>
          <a href="#/" className="file-link" onClick={showDropZone}>
            Open your own MusicXML file
          </a>
        </p>
      </header>

      <section className="card stack" aria-labelledby="start-here">
        <h2 id="start-here">Start here</h2>
        <p>
          <strong>{start.title}</strong> by {start.composer}
        </p>
        <p className="muted">
          {LEVEL_NAMES[start.level]} · {formatDuration(start.approxDurationSec)}
        </p>
        <Button primary onClick={() => open({ kind: 'library', slug: start.slug })}>
          Start with {start.title}
        </Button>
      </section>

      {piecesByLevel.map(([level, group]) => (
        <section key={level} className="level" aria-labelledby={`level-${level}`}>
          <h2 id={`level-${level}`}>
            Level {level}: {LEVEL_NAMES[level]}
          </h2>
          <ul className="piece-list">
            {group.map((p) => (
              <li key={p.slug}>
                <button
                  type="button"
                  className="piece-row"
                  aria-label={`Open ${p.title} by ${p.composer}`}
                  aria-describedby={
                    p.hasEditorialFingering
                      ? `${p.slug}-duration ${p.slug}-tag`
                      : `${p.slug}-duration`
                  }
                  onClick={() => open({ kind: 'library', slug: p.slug })}
                >
                  <span className="title">
                    {p.title}
                    {p.hasEditorialFingering && (
                      <span id={`${p.slug}-tag`} className="tag">
                        editor's fingering
                      </span>
                    )}
                  </span>
                  <span className="composer muted">{p.composer}</span>
                  <span id={`${p.slug}-duration`} className="duration">
                    {formatDuration(p.approxDurationSec)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <DropZone
        onFile={(name, bytes) => open({ kind: 'file', name, bytes })}
        onRefuse={setNotice}
        zoneRef={dropZone}
        chooserRef={chooser}
      />

      <footer className="library-footer">
        <button type="button" className="text-button" onClick={about}>
          About and licences
        </button>
      </footer>
    </main>
  );
}
