import { useLayoutEffect } from 'react';

/**
 * How much of a column-reverse scroller lies out of sight above and below, from its scroll
 * offset. The offset runs from `-(scrollHeight - clientHeight)` (scrolled to the top) to 0 (at
 * the bottom, by Play); a pixel of rounding is no content.
 */
export function hiddenEdges(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): { above: boolean; below: boolean } {
  const overflow = Math.max(0, scrollHeight - clientHeight);
  return { above: overflow + scrollTop > 1, below: scrollTop < -1 };
}

/**
 * Marks the phone's capped Practice panel with a cue at each edge that cuts off more controls
 * (issue 244), so the reader sees the list goes on whatever lies under the edge. The cue is the
 * panel's own inset shadow (`data-above`, `data-below`; `.practice-panel` in `base.css`): a gray
 * hairline, no control and no colour. Follows the scroll and the panel's size.
 */
export function usePanelEdges(dock: Element | null, active: boolean): void {
  useLayoutEffect(() => {
    const panel = active ? (dock?.querySelector<HTMLElement>('.practice-panel') ?? null) : null;
    if (!panel) return;
    const update = () => {
      const { above, below } = hiddenEdges(panel.scrollTop, panel.scrollHeight, panel.clientHeight);
      if (above) panel.dataset.above = '';
      else delete panel.dataset.above;
      if (below) panel.dataset.below = '';
      else delete panel.dataset.below;
    };
    update();
    panel.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(panel);
    for (const child of Array.from(panel.children)) observer?.observe(child);
    return () => {
      panel.removeEventListener('scroll', update);
      observer?.disconnect();
      delete panel.dataset.above;
      delete panel.dataset.below;
    };
  }, [dock, active]);
}
