import { useEffect, type RefObject } from 'react';

/** The heading of the view the page loaded with; undefined until the first view mounts. */
let landing: HTMLElement | undefined;

/**
 * Moves the focus to a view's heading when the view replaces another one (a library row opened,
 * Back pressed, the about link followed): the control that had the focus is gone, and without
 * this the focus falls to <body>, the next Tab starts at the top of the document and a screen
 * reader announces nothing. The view the page loads with leaves the focus to the browser. The
 * heading needs `tabIndex={-1}`, so it takes the focus without becoming a tab stop.
 *
 * React's StrictMode remounts a view on its first load with the same heading element, which is
 * recognised as the landing view rather than a new one.
 */
export function useFocusOnArrival(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (landing === undefined) {
      landing = el;
      return;
    }
    if (el !== landing) el.focus({ preventScroll: true });
  }, [ref]);
}
