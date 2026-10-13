export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** One-shot fade-in used when a digit changes after a re-solve. Never used for the cursor. */
export function flash(el: Element): void {
  if (prefersReducedMotion()) return;
  const animate = (el as Element & { animate?: Element['animate'] }).animate;
  if (typeof animate !== 'function') return;
  animate.call(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
}
