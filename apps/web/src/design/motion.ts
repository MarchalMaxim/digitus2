export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
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
