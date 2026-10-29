import type { Phrase } from '../i18n/messages.js';
import { pieceBySlug } from '../library/manifest.js';
import { keepScansFromHash } from '../scan/diagnostics.js';
import type { useAppStore, View } from './store.js';

const FILE_HASH = '#/piece/file';
const PIECE_PREFIX = '#/piece/';
const SHARED_PREFIX = '#/shared/';

/** Uploaded scores reopen explicitly from the local collection, without starting a scan. */
export const FILE_NOT_RESTORABLE_NOTICE: Phrase = (t) => t.app.fileNotRestorable;

/** A shared score's address names nothing the shared library can give (issue 132). */
export const SHARED_NOT_LOADED_NOTICE: Phrase = (t) => t.library.shared.notLoaded;

/** An address names a piece the library does not hold (issue 59, review L4). */
export const UNKNOWN_PIECE_NOTICE: Phrase = (t) => t.app.unknownPiece;

export function viewToHash(view: View): string {
  switch (view.name) {
    case 'library':
      return '#/';
    case 'about':
      return '#/about';
    case 'scan':
      return '#/scan';
    case 'score':
      return view.source.kind === 'library'
        ? `${PIECE_PREFIX}${view.source.slug}`
        : view.source.kind === 'shared'
          ? `${SHARED_PREFIX}${view.source.id}`
          : FILE_HASH;
  }
}

/** The id a '#/shared/<id>' address names: 32 lowercase hex characters, else null. */
export function sharedIdFromHash(hash: string): string | null {
  const id = hash.startsWith(SHARED_PREFIX) ? hash.slice(SHARED_PREFIX.length) : '';
  return /^[0-9a-f]{32}$/.test(id) ? id : null;
}

/**
 * The view a hash names, or null for '#/piece/file' (not restorable), unknown hashes and a shared
 * score's address (its score has to be fetched first: `sharedIdFromHash`).
 */
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

  // True while a shared score named by the address is being fetched: the address stays as it is.
  const applyHash = (): boolean => {
    const hash = location.hash;
    const { view } = store.getState();
    if (viewToHash(view) === hash) return false;
    const sharedId = sharedIdFromHash(hash);
    if (sharedId) {
      void import('../library/shared/open.js').then((m) => m.openSharedAt(store, sharedId, hash));
      return true;
    }
    // A scan-derived score retains its source. Back restores that review; after a reload
    // the reader chooses the saved item explicitly from My scores.
    if (
      hash === '#/scan' &&
      view.name === 'score' &&
      view.source.kind === 'file' &&
      view.source.scan
    ) {
      store.setState({ view: { name: 'scan', session: view.source.scan } });
      return false;
    }
    const next = hashToView(hash);
    if (next) {
      store.setState({ view: next });
      return false;
    }
    // Not restorable or unknown: fall back to the library. Correct the hash first so the view
    // change below finds it already in place and does not push a second history entry.
    if (hash === FILE_HASH || hash === '#/scan')
      store.setState({ notice: FILE_NOT_RESTORABLE_NOTICE });
    else if (hash.startsWith(PIECE_PREFIX)) store.setState({ notice: UNKNOWN_PIECE_NOTICE });
    else if (hash.startsWith(SHARED_PREFIX)) store.setState({ notice: SHARED_NOT_LOADED_NOTICE });
    replaceHash(viewToHash({ name: 'library' }));
    if (view.name !== 'library') store.setState({ view: { name: 'library' } });
    return false;
  };

  // '#keep-scans' and '#keep-scans-off' switch this device's scan keeping (diagnostics.ts) and leave
  // the address where it was, without a history entry; the view stays as it is.
  const keepFromHash = (): boolean => {
    if (!keepScansFromHash(location.hash)) return false;
    replaceHash(viewToHash(store.getState().view));
    return true;
  };

  keepFromHash();
  if (!applyHash()) replaceHash(viewToHash(store.getState().view));

  const onHashChange = () => void (keepFromHash() || applyHash());
  const unsubscribe = store.subscribe((state, prev) => {
    if (state.view === prev.view) return;
    const hash = viewToHash(state.view);
    if (hash !== location.hash) location.hash = hash;
  });
  window.addEventListener('hashchange', onHashChange);

  return () => {
    unsubscribe();
    window.removeEventListener('hashchange', onHashChange);
  };
}
