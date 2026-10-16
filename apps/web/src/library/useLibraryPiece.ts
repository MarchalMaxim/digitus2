import { useEffect, useState } from 'react';
import { loadPiece, type LibraryPiece } from './manifest.js';

/**
 * The full entry of a library piece once its manifest chunk has loaded; null before that, for no
 * slug, and for a slug the library does not hold.
 */
export function useLibraryPiece(slug: string | null): LibraryPiece | null {
  const [loaded, setLoaded] = useState<{ slug: string; piece: LibraryPiece | undefined } | null>(
    null,
  );
  useEffect(() => {
    if (slug === null) return;
    let live = true;
    void loadPiece(slug).then((piece) => {
      if (live) setLoaded({ slug, piece });
    });
    return () => {
      live = false;
    };
  }, [slug]);
  return slug !== null && loaded?.slug === slug ? (loaded.piece ?? null) : null;
}
