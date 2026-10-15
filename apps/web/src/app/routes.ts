import { pieceBySlug } from '../library/manifest.js';
import type { useAppStore, View } from './store.js';

const FILE_HASH = '#/piece/file';
const PIECE_PREFIX = '#/piece/';

/** Shown when the URL points at a dropped file whose bytes are gone (reload, Back, Forward). */
export const FILE_NOT_RESTORABLE_NOTICE = 'Drop the file again to continue.';

export function viewToHash(view: View): string {
  switch (view.name) {
    case 'library':
      return '#/';
    case 'about':
      return '#/about';
    case 'scan':
      return '#/scan';
    case 'score':
      return view.source.kind === 'library' ? `${PIECE_PREFIX}${view.source.slug}` : FILE_HASH;
  }
}

/** The view a hash names, or null for '#/piece/file' (not restorable) and unknown hashes. */
export function hashToView(hash: string): View | null {
  if (hash === '' || hash === '#' || hash === '#/') return { name: 'library' };
  if (hash === '#/about') return { name: 'about' };
  if (hash.startsWith(PIECE_PREFIX) && hash !== FILE_HASH) {
    const slug = hash.slice(PIECE_PREFIX.length);
    if (pieceBySlug(slug)) return { name: 'score', source: { kind: 'library', slug } };
  }
  return null;
}

/**
 * Mirrors the store's view in the URL hash and back. The store is the source of truth: a view
 * change writes the hash (a new history entry, so Back works); a hashchange sets the view. Each
 * side compares before writing, so the echo of our own write is a no-op.
 */
export function installHashSync(store: typeof useAppStore): () => void {
  // replaceState never fires hashchange and adds no history entry: used for corrections only.
  const replaceHash = (hash: string) => {
    if (hash !== location.hash) history.replaceState(history.state, '', hash);
  };

  const applyHash = () => {
    const hash = location.hash;
    const { view } = store.getState();
    if (viewToHash(view) === hash) return;
    // A scan-derived score retains its visit-only source. Back can restore that review;
    // a reload still falls through to the ordinary non-restorable-file notice.
    if (
      hash === '#/scan' &&
      view.name === 'score' &&
      view.source.kind === 'file' &&
      view.source.scan
    ) {
      store.setState({ view: { name: 'scan', session: view.source.scan } });
      return;
    }
    const next = hashToView(hash);
    if (next) {
      store.setState({ view: next });
      return;
    }
    // Not restorable or unknown: fall back to the library. Correct the hash first so the view
    // change below finds it already in place and does not push a second history entry.
    if (hash === FILE_HASH || hash === '#/scan')
      store.setState({ notice: FILE_NOT_RESTORABLE_NOTICE });
    replaceHash(viewToHash({ name: 'library' }));
    if (view.name !== 'library') store.setState({ view: { name: 'library' } });
  };

  applyHash();
  replaceHash(viewToHash(store.getState().view));

  const unsubscribe = store.subscribe((state, prev) => {
    if (state.view === prev.view) return;
    const hash = viewToHash(state.view);
    if (hash !== location.hash) location.hash = hash;
  });
  window.addEventListener('hashchange', applyHash);

  return () => {
    unsubscribe();
    window.removeEventListener('hashchange', applyHash);
  };
}
