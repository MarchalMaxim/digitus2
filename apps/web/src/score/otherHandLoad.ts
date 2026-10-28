import type * as TransportExports from '../audio/transport.js';
import type * as OtherHandExports from './otherHand.js';

/**
 * The other hand's lazy chunk (otherHand.ts) with the transport's note list: what the walk and the
 * playback use once it is in. The list comes from the transport chunk, which an open score fetches
 * anyway, so it is not a second copy in the other hand's chunk and no chunk shared by the two
 * leaves the first load heavier.
 */
export type OtherHand = typeof OtherHandExports & Pick<typeof TransportExports, 'playEventsFor'>;

/** Fetches the chunks: tests wait for them or fail them through `resetOtherHandForTests`. */
export async function importOtherHand(): Promise<OtherHand> {
  const [hand, transport] = await Promise.all([
    import('./otherHand.js'),
    import('../audio/transport.js'),
  ]);
  return { ...hand, playEventsFor: transport.playEventsFor };
}

let importer = importOtherHand;
let pending: Promise<OtherHand> | null = null;
let loaded: OtherHand | null = null;

/**
 * The chunk, fetched once; a failed fetch is tried again on the next call. The walk asks for it
 * while the reader's switch is on (usePlayAlong.ts), and goes on without the other hand when it
 * does not come.
 */
export function loadOtherHand(): Promise<OtherHand> {
  pending ??= importer().then(
    (m) => (loaded = m),
    (e: unknown) => {
      pending = null;
      throw e;
    },
  );
  return pending;
}

/** The chunk when it has been fetched, else null: `accompany` plays only with it. */
export function otherHandLoaded(): OtherHand | null {
  return loaded;
}

/** Forgets the chunk; tests pass their own fetch (a gated one, a failing one). */
export function resetOtherHandForTests(next: () => Promise<OtherHand> = importOtherHand): void {
  importer = next;
  pending = null;
  loaded = null;
}
