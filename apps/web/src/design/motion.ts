/** The design system's easing (tokens.css, --ease), for animations started from script. */
export const EASE = 'cubic-bezier(0.2, 0, 0, 1)';

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** tokens.css's --dur-slow, for a document without the stylesheet (unit tests). */
export const DUR_SLOW_FALLBACK_MS = 200;

/**
 * A duration token in ms, from the root's computed style ("200ms", "0.2s", "0ms"), so script
 * waits as long as the stylesheet does, and 0 under prefers-reduced-motion like the CSS. Without
 * a value (no stylesheet): 0 under prefers-reduced-motion, else `fallback`.
 */
export function durationMs(token: string, fallback: number = DUR_SLOW_FALLBACK_MS): number {
  const none = prefersReducedMotion() ? 0 : fallback;
  if (typeof document === 'undefined') return none;
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  const m = /^(\d*\.?\d+)(ms|s)$/.exec(value);
  if (!m) return none;
  return Number(m[1]) * (m[2] === 's' ? 1000 : 1);
}

/**
 * How long the red takes to travel between Play and the cursor (score/RedFlight.tsx). A Play from
 * the start without a count-in holds the first note back this long, so it sounds as the red lands.
 */
export const RED_FLIGHT_MS = 200;

/**
 * How long the red's hop to a bar sought takes (T13, score/RedFlight.tsx), from a neighbouring
 * note to across the page: long enough to follow, short enough that the music, which waits for
 * it while playing, never seems to hesitate.
 */
export const HOP_MIN_MS = 220;
export const HOP_MAX_MS = 340;

/** How long a key held down takes to lift and go down again when its note is struck again. */
export const RESTRIKE_MS = 110;

/**
 * A key struck again while it is held (a repeated note): it lifts and goes down again, from its
 * pressed transform (base.css, `.keyboard-svg .key.is-pressed`) through none and back. Never
 * under prefers-reduced-motion, and nothing without element.animate.
 */
export function restrike(el: Element | null): void {
  if (!el || prefersReducedMotion()) return;
  const animate = (el as Element & { animate?: Element['animate'] }).animate;
  if (typeof animate !== 'function') return;
  const own = getComputedStyle(el).transform;
  const down = own && own !== 'none' ? own : 'none';
  animate.call(
    el,
    [{ transform: down }, { transform: 'none', offset: 0.35 }, { transform: down }],
    { duration: RESTRIKE_MS, easing: EASE },
  );
}

/**
 * One-shot fade-in used when a digit changes after a re-solve. Never used for the cursor. It
 * fades in to the element's own opacity: a dimmed digit (the hand left out of one-hand
 * practice) ends dimmed rather than jumping back from full ink.
 */
export function flash(el: Element): void {
  if (prefersReducedMotion()) return;
  const animate = (el as Element & { animate?: Element['animate'] }).animate;
  if (typeof animate !== 'function') return;
  const own = parseFloat(getComputedStyle(el).opacity);
  const opacity = Number.isFinite(own) ? own : 1;
  animate.call(el, [{ opacity: 0 }, { opacity }], { duration: 160, easing: 'ease-out' });
}
