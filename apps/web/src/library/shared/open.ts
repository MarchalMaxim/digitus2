import { SHARED_NOT_LOADED_NOTICE } from '../../app/routes.js';
import { useAppStore, type PieceSource } from '../../app/store.js';
import { unpack } from './payload.js';
import { getShared } from './store.js';

/** A shared score as a source the score view opens, or null when the store has none by this id. */
export async function loadShared(
  id: string,
): Promise<Extract<PieceSource, { kind: 'shared' }> | null> {
  const found = await getShared(id);
  if (!found) return null;
  const xml = await unpack(found.score);
  return {
    kind: 'shared',
    id,
    name: `${found.title || 'score'}.musicxml`,
    bytes: new TextEncoder().encode(xml),
    title: found.title,
    composer: found.composer,
    origin: found.kind,
  };
}

/** From a shelf row: fetches the score and opens it; a failure leaves the library with a notice. */
export async function openShared(id: string): Promise<void> {
  const store = useAppStore.getState();
  try {
    const source = await loadShared(id);
    if (!source) throw new Error('not shared');
    if (useAppStore.getState().view.name !== 'library') return;
    store.setNotice(null);
    store.openPiece(source);
  } catch {
    store.setNotice(SHARED_NOT_LOADED_NOTICE);
  }
}

/**
 * From an address ('#/shared/<id>', typed, followed, or restored after a reload): fetches the
 * score and shows it, unless the address has changed meanwhile. A score that cannot be loaded
 * puts the library on screen with a notice, and the address back to the library's.
 */
export async function openSharedAt(
  store: typeof useAppStore,
  id: string,
  hash: string,
): Promise<void> {
  let source: PieceSource | null = null;
  try {
    source = await loadShared(id);
  } catch {
    source = null;
  }
  if (location.hash !== hash) return;
  if (source) {
    store.setState({ view: { name: 'score', source } });
    return;
  }
  history.replaceState(history.state, '', '#/');
  store.setState({ notice: SHARED_NOT_LOADED_NOTICE, view: { name: 'library' } });
}
