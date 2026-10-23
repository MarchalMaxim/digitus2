/**
 * The page window (issue 99): a long piece's pages are inline SVG of 100,000 elements and more,
 * about 1.5 KB of Blink heap each (docs/research/ram-usage.md), so only the pages near the screen
 * are kept in the DOM. Every page stands in the sheet as its own `<svg>` start tag (the viewBox
 * keeps its height, so the scroll height never changes) and is filled from its markup when it comes
 * within a window height of the window, and emptied again beyond two window heights (hysteresis).
 * The page holding the red is never emptied. The page nodes themselves are never replaced, so
 * what holds one (the cursor's first page, the bar boxes, the viewBox) stays valid.
 *
 * Whatever reads the pages brings in the ones it needs first: `ensureNotes` (the cursor),
 * `ensureBar` (a seek), `ensurePage` (measuring a page). Whatever decorates a page (the dimming of
 * the hand left out, the digits patched since the layout) does so in `onBuilt`.
 */
import { pageOfBar, type PageIndex } from './pageIndex.js';

/** A piece of fewer pages is built whole: the saving is not worth the placeholders. */
export const WINDOW_MIN_PAGES = 6;

/** A page's vertical extent in viewport pixels. */
export interface PageSpan {
  top: number;
  bottom: number;
}

/**
 * The pages to keep built. A page is built when it is within `buildPx` of the window (`viewHeight`
 * tall), a page already built stays until it is beyond `tearPx`, and a pinned page always stays.
 */
export function pagesToKeep(
  spans: readonly PageSpan[],
  viewHeight: number,
  built: ReadonlySet<number>,
  pinned: ReadonlySet<number>,
  buildPx = viewHeight,
  tearPx = 2 * viewHeight,
): Set<number> {
  const keep = new Set<number>();
  spans.forEach((span, i) => {
    const within = (px: number) => span.bottom > -px && span.top < viewHeight + px;
    if (pinned.has(i) || within(buildPx) || (built.has(i) && within(tearPx))) keep.add(i);
  });
  return keep;
}

/**
 * Gives a page the aspect ratio of its viewBox. The pages off screen skip their rendering (base.css,
 * `content-visibility: auto`, issue 79), and a skipped page has no natural size: the ratio keeps
 * its height, so nothing moves when it is next drawn. A page without a viewBox is left as it is.
 */
export function keepAspect(page: Element): void {
  const box = (page.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const [, , width, height] = box;
  if (box.length !== 4 || !(width! > 0) || !(height! > 0)) return;
  (page as SVGElement).style.aspectRatio = `${width} / ${height}`;
}

const windows = new WeakMap<Element, PageWindow>();

/** The page window of a score sheet's host, when it has one. */
export function pageWindowOf(host: Element): PageWindow | undefined {
  return windows.get(host);
}

export class PageWindow {
  private slots: SVGSVGElement[] = [];
  private built = new Set<number>();
  private observers: IntersectionObserver[] = [];
  private pending = false;
  private disposed = false;
  /** The page the red was last brought to: when it moves on, the page it left may go. */
  private redPage = -1;

  /**
   * `onBuilt` is called with each page built after `start()`, once it is filled. The pages built
   * by `start()` itself are not announced: the caller decorates them when it has started.
   */
  constructor(
    readonly host: HTMLElement,
    readonly index: PageIndex,
    private readonly onBuilt: (page: SVGSVGElement, i: number) => void,
  ) {}

  /** Stands the placeholders in the host and fills those near the window. */
  start(): void {
    const { host, index } = this;
    host.innerHTML = index.open.map((open) => `${open}</svg>`).join('');
    this.slots = Array.from(host.children) as SVGSVGElement[];
    this.slots.forEach((slot, i) => {
      keepAspect(slot);
      slot.setAttribute('data-page', String(i));
      slot.setAttribute('data-first-bar', String(index.firstBar[i]));
      slot.setAttribute('data-bars', String(index.bars[i]));
    });
    windows.set(host, this);
    if (this.slots.length < WINDOW_MIN_PAGES || typeof IntersectionObserver === 'undefined') {
      this.buildAll(false);
      return;
    }
    this.update(false);
    // One observer for the build line and one for the tear line: a page is reported as it crosses
    // either, and the rule (`pagesToKeep`) reads the pages' boxes.
    for (const margin of ['100%', '200%']) {
      const observer = new IntersectionObserver(() => this.schedule(), {
        rootMargin: `${margin} 0px ${margin} 0px`,
      });
      for (const slot of this.slots) observer.observe(slot);
      this.observers.push(observer);
    }
  }

  /** Works the window out at the next frame, once however many pages crossed a line. */
  schedule(): void {
    if (this.pending || this.disposed) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.update();
    });
  }

  /** Builds the pages near the window and empties those beyond it, sparing the red's. */
  update(announce = true): void {
    if (this.disposed) return;
    const viewHeight = window.innerHeight || document.documentElement.clientHeight;
    const spans = this.slots.map((slot) => {
      const r = slot.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    });
    // A sheet that is not rendered (hidden for print) has no boxes: every page would sit at 0 and
    // be taken for one in the window. Leave the pages as they are until it is shown again.
    if (spans.length > 0 && spans.every((s) => s.bottom <= s.top)) return;
    const pinned = new Set<number>();
    for (const i of this.built) {
      if (this.slots[i]!.getElementsByClassName('is-red').length > 0) pinned.add(i);
    }
    const keep = pagesToKeep(spans, viewHeight, this.built, pinned);
    for (const i of [...this.built]) if (!keep.has(i)) this.tear(i);
    for (const i of keep) this.build(i, announce);
  }

  isBuilt(i: number): boolean {
    return this.built.has(i);
  }

  /** Builds page `i` (0-based) when it is not built. */
  ensurePage(i: number): void {
    if (i >= 0 && i < this.slots.length) this.build(i, true);
  }

  /** Builds the pages holding the notes `ids`: before marking them. */
  ensureNotes(ids: Iterable<string>): void {
    let first = -1;
    for (const id of ids) {
      const page = this.index.pageOfNote.get(id);
      if (page === undefined) continue;
      if (first < 0) first = page;
      this.ensurePage(page);
    }
    if (first >= 0 && first !== this.redPage) {
      this.redPage = first;
      this.schedule();
    }
  }

  /** Builds the page holding bar `bar` (0-based among the bars of every page): before a seek. */
  ensureBar(bar: number): void {
    this.ensurePage(pageOfBar(this.index, bar));
  }

  /** Builds every page. */
  buildAll(announce = true): void {
    for (let i = 0; i < this.slots.length; i++) this.build(i, announce);
  }

  dispose(): void {
    this.disposed = true;
    for (const observer of this.observers) observer.disconnect();
    this.observers = [];
    if (windows.get(this.host) === this) windows.delete(this.host);
  }

  private build(i: number, announce: boolean): void {
    if (this.built.has(i)) return;
    const slot = this.slots[i]!;
    slot.innerHTML = this.index.inner[i]!;
    this.built.add(i);
    if (announce) this.onBuilt(slot, i);
  }

  private tear(i: number): void {
    this.slots[i]!.replaceChildren();
    this.built.delete(i);
  }
}
