import { useLayoutEffect } from 'react';

/**
 * How much of a scroller lies out of sight above and below, from its scroll offset; a pixel of
 * rounding is no content.
 */
export function hiddenEdges(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): { above: boolean; below: boolean } {
  const overflow = Math.max(0, scrollHeight - clientHeight);
  return { above: scrollTop > 1, below: overflow - scrollTop > 1 };
}

/** The lower hairline's width: the used control stands clear of it, so the cue is not drawn over it. */
export const EDGE_CLEARANCE = 1;

/** The control the reader used: its offset from the panel's top edge before and after a change. */
export interface UsedControl {
  before: number;
  after: number;
  height: number;
}

/**
 * Where the panel scrolls to when its content changed and moved or grew the control the reader
 * used (issue 244). Scrolled away from the top, that control stays where it was, so a row arriving
 * above it moves nothing under the reader's finger. At the top, the head stays: the control is
 * only brought back as far as it needs to stand whole in the box, clear of the lower hairline, and
 * never past its own top (a control taller than the box shows its start). When the head and the
 * control cannot both stand in the box, the control wins.
 */
export function keepScroll(
  scrollTop: number,
  used: UsedControl | null,
  clientHeight: number,
): number {
  if (!used) return scrollTop;
  if (scrollTop > 1) {
    const moved = used.after - used.before;
    return Math.abs(moved) < 1 ? scrollTop : Math.max(0, scrollTop + moved);
  }
  const whole = used.after + used.height + EDGE_CLEARANCE - clientHeight;
  return Math.max(0, scrollTop, Math.min(whole, used.after));
}

/**
 * What a gesture in the panel lands on: what "the control the reader used" can be. A segmented
 * control is one control, the whole fieldset, whichever of its segments was tapped.
 */
const CONTROL = 'input, select, button, label, summary, a';
const GROUP = 'fieldset';

/**
 * Keeps the phone's capped Practice panel in order (issue 244). It opens at its top. It marks
 * each edge that cuts off more controls (`data-above`, `data-below`; `.practice-panel` in
 * `base.css`) with a cue, so the reader sees the list goes on whatever lies under the edge: the
 * panel's own inset shadow, a gray hairline, no control and no colour. And when its content
 * changes size it keeps the head and the control the reader just used where they are
 * (`keepScroll`): the browser's own scroll anchoring is off for the panel (`overflow-anchor`,
 * base.css) and WebKit has none. That control is the target of the last gesture in the panel,
 * since WebKit does not focus a radio or a checkbox when it is tapped.
 */
export function usePanelEdges(dock: Element | null, active: boolean): void {
  useLayoutEffect(() => {
    const panel = active ? (dock?.querySelector<HTMLElement>('.practice-panel') ?? null) : null;
    if (!panel) return;
    panel.scrollTop = 0;
    let used: HTMLElement | null = null;
    let usedAt = 0;
    const offset = (el: HTMLElement) =>
      el.getBoundingClientRect().top - panel.getBoundingClientRect().top;
    /** Remembers where the used control stands. */
    const note = () => {
      if (used && !used.isConnected) used = null;
      if (used) usedAt = offset(used);
    };
    const mark = () => {
      const { above, below } = hiddenEdges(panel.scrollTop, panel.scrollHeight, panel.clientHeight);
      if (above) panel.dataset.above = '';
      else delete panel.dataset.above;
      if (below) panel.dataset.below = '';
      else delete panel.dataset.below;
    };
    const update = () => {
      if (used && !used.isConnected) used = null;
      if (used) {
        const next = keepScroll(
          panel.scrollTop,
          { before: usedAt, after: offset(used), height: used.getBoundingClientRect().height },
          panel.clientHeight,
        );
        if (next !== panel.scrollTop) panel.scrollTop = next;
      }
      note();
      mark();
    };
    const onScroll = () => {
      note();
      mark();
    };
    const use = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      used =
        target && panel.contains(target)
          ? (target.closest<HTMLElement>(GROUP) ?? target.closest<HTMLElement>(CONTROL))
          : null;
      note();
    };
    const leave = (event: FocusEvent) => {
      if (!(event.relatedTarget instanceof Node && panel.contains(event.relatedTarget)))
        used = null;
    };
    mark();
    panel.addEventListener('scroll', onScroll, { passive: true });
    panel.addEventListener('focusin', use);
    panel.addEventListener('focusout', leave);
    document.addEventListener('pointerdown', use, true);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(panel);
    for (const child of Array.from(panel.children)) observer?.observe(child);
    return () => {
      panel.removeEventListener('scroll', onScroll);
      panel.removeEventListener('focusin', use);
      panel.removeEventListener('focusout', leave);
      document.removeEventListener('pointerdown', use, true);
      observer?.disconnect();
      delete panel.dataset.above;
      delete panel.dataset.below;
    };
  }, [dock, active]);
}
