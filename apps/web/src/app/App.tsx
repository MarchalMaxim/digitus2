import { lazy, Suspense } from 'react';
import { useAppStore, type PieceSource } from './store.js';
import { Notice } from './Notice.js';
import { LibraryView } from '../library/LibraryView.js';
import { ScoreView } from '../score/ScoreView.js';
import { fileIdentity } from '../score/useScoreDocument.js';

// A lazy chunk: the About view reads ENGINE_VERSION from the engine's public API, and that import
// keeps @xmldom/xmldom (CommonJS, so the bundler cannot drop it) in whatever chunk holds the view.
// Imported eagerly it pushed the library page's initial JavaScript from 85 to 151 KB gzip.
const AboutView = lazy(() =>
  import('../about/AboutView.js').then((m) => ({ default: m.AboutView })),
);

/**
 * A fresh score view per piece: the slug, or the dropped file's name and content (the same
 * identity the score document uses), so a different file never inherits the playback and loop
 * inputs of the one before it.
 */
function sourceKey(source: PieceSource): string {
  return source.kind === 'library'
    ? `piece:${source.slug}`
    : `file:${source.name}:${fileIdentity(source.bytes)}`;
}

export function App() {
  const view = useAppStore((s) => s.view);
  return (
    <>
      <Notice />
      {view.name === 'library' && <LibraryView />}
      {view.name === 'score' && <ScoreView key={sourceKey(view.source)} source={view.source} />}
      {view.name === 'about' && (
        <Suspense fallback={null}>
          <AboutView />
        </Suspense>
      )}
    </>
  );
}
