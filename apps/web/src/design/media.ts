import { useCallback, useMemo, useSyncExternalStore } from 'react';

/** Narrow screens: the stylesheet's own breakpoint (base.css, `@media (max-width: 479.98px)`). */
export const NARROW_QUERY = '(max-width: 479.98px)';

/** Screens pointed at with a finger (a phone, a tablet): nothing hovers there, and no arrow keys. */
export const TOUCH_QUERY = '(hover: none)';

function listFor(query: string): MediaQueryList | null {
  return typeof matchMedia === 'function' ? matchMedia(query) : null;
}

/**
 * Whether a media query matches, kept current as the window changes (a phone turned on its
 * side). For layout the stylesheet cannot do alone, such as folding controls into a disclosure.
 * False where matchMedia does not exist.
 *
 * One MediaQueryList per query, read on every render and listened to: the score view renders on
 * every change of pressed keys during playback, so a list per render would be garbage at that
 * rate. The app renders only in the browser, so there is no server snapshot.
 */
export function useMediaQuery(query: string): boolean {
  const list = useMemo(() => listFor(query), [query]);
  const subscribe = useCallback(
    (onChange: () => void) => {
      list?.addEventListener('change', onChange);
      return () => list?.removeEventListener('change', onChange);
    },
    [list],
  );
  return useSyncExternalStore(subscribe, () => list?.matches ?? false);
}
