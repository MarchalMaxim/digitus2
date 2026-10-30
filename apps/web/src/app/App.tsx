import { lazy, Suspense, useEffect, useLayoutEffect, useRef } from 'react';
import { useT } from '../i18n/i18n.js';
import { pieceKey, useAppStore, type View } from './store.js';
import { NoteBurst } from './NoteBurst.js';
import { Notice } from './Notice.js';
import { Opening, OpeningAnnouncement } from './Opening.js';
import { LibraryView } from '../library/LibraryView.js';

// A lazy chunk: the About view reads ENGINE_VERSION from the engine's public API, and that import
// keeps @xmldom/xmldom (CommonJS, so the bundler cannot drop it) in whatever chunk holds the view.
// Imported eagerly it pushed the library page's initial JavaScript from 85 to 151 KB gzip.
const ScanView = lazy(() => import('../scan/ScanView.js').then((m) => ({ default: m.ScanView })));

// A lazy chunk as well: the score view (playback, keyboard, play-along, printing) is not needed to
// draw the library, which keeps the library page's first load within its budget. It is fetched as
// soon as the library has drawn (App, below), so opening a piece does not wait for it.
const loadScoreView = () => import('../score/ScoreView.js');
const ScoreView = lazy(() => loadScoreView().then((m) => ({ default: m.ScoreView })));

const AboutView = lazy(() =>
  import('../about/AboutView.js').then((m) => ({ default: m.AboutView })),
);

/**
 * A view's identity: the same piece (or file) set again is the same view, the same score view.
 * A fresh score view per piece (`pieceKey`: the slug, or the dropped file's name and content, the
 * same identity the score document uses), so a different file never inherits the playback and
 * loop inputs of the one before it.
 */
function viewKey(view: View): string {
  return view.name === 'score'
    ? pieceKey(view.source)
    : view.name === 'scan'
      ? 'scan:' + view.session.id
      : view.name;
}

/**
 * Where the window scrolls when a view replaces another. A new view opens at its top, with its
 * heading (and, in the score view, Play and the first system) on the first screen: the old
 * view's offset, clamped to the new page, used to hide both on a phone. The library comes back
 * where the reader left it, by a control or through the history (LibraryView writes the offset
 * when it unmounts, in the same commit, before this runs). Instant, in a layout effect, so the
 * new view never paints at the old offset.
 *
 * The view the page loads with leaves the scroll to the browser, and the same view set again
 * does not move the page. That also keeps this from ever fighting the cursor's own scroll: a
 * playback lives in one score view, and every change of key mounts a new view (the score view
 * is keyed the same way), which stops the old playback.
 */
function useScrollOnViewChange(key: string): void {
  const shown = useRef<string | null>(null);
  useLayoutEffect(() => {
    const previous = shown.current;
    shown.current = key;
    if (previous === null || previous === key) return;
    const top = key === 'library' ? useAppStore.getState().libraryScrollY : 0;
    window.scrollTo({ top, left: 0, behavior: 'instant' });
  }, [key]);
}

export function App() {
  const t = useT();
  useEffect(() => {
    void import('../library/local/library.js').then((m) => m.installLocalLibrary());
    void loadScoreView();
  }, []);
  const view = useAppStore((s) => s.view);
  const opening = useAppStore((s) => s.opening);
  const key = viewKey(view);
  useScrollOnViewChange(key);
  return (
    <>
      <Notice />
      <OpeningAnnouncement />
      {/* A reload on an address that names a saved score (issue 242): the loader, never a flash of
          the library the score then replaces. */}
      {view.name === 'library' && (opening === 'address' ? <Opening /> : <LibraryView />)}
      {view.name === 'score' && (
        <Suspense fallback={<Opening />}>
          <ScoreView key={key} source={view.source} />
        </Suspense>
      )}
      {view.name === 'scan' && (
        <Suspense fallback={<p className="page">{t.app.openingScan}</p>}>
          <ScanView key={key} session={view.session} />
        </Suspense>
      )}
      {view.name === 'about' && (
        <Suspense fallback={null}>
          <AboutView />
        </Suspense>
      )}
      <NoteBurst />
    </>
  );
}
