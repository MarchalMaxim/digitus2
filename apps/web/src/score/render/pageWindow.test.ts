import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPageIndex } from './pageIndex.js';
import { pagesToKeep, PageWindow, pageWindowOf, WINDOW_MIN_PAGES } from './pageWindow.js';

/** `n` pages of two bars each, one note per bar, with the ids `n<page>-<bar>`. */
function pages(n: number): string[] {
  return Array.from({ length: n }, (_, p) => {
    const bar = (b: number) =>
      `<g id="m${p}-${b}" class="measure"><g class="staff"><g id="n${p}-${b}" class="note"><use/></g></g></g>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2100 2970"><g class="page-margin">${bar(0)}${bar(1)}</g></svg>`;
  });
}

const spans = (scroll: number, n = 10) =>
  Array.from({ length: n }, (_, i) => ({
    top: 1000 * i - scroll,
    bottom: 1000 * i + 1000 - scroll,
  }));
const range = (a: number, b: number) => new Set(Array.from({ length: b - a + 1 }, (_, i) => a + i));

describe('pagesToKeep', () => {
  const none = new Set<number>();
  it('builds the pages within a window height of the window', () => {
    expect(pagesToKeep(spans(0), 900, none, none)).toEqual(new Set([0, 1]));
    expect(pagesToKeep(spans(5000), 900, none, none)).toEqual(new Set([4, 5, 6]));
  });

  it('keeps a built page until it is two window heights away', () => {
    const all = range(0, 9);
    expect(pagesToKeep(spans(5000), 900, all, none)).toEqual(range(3, 7));
  });

  it('always keeps the pinned pages', () => {
    expect(pagesToKeep(spans(5000), 900, range(0, 9), new Set([0]))).toEqual(
      new Set([0, 3, 4, 5, 6, 7]),
    );
    expect(pagesToKeep(spans(5000), 900, none, new Set([9]))).toEqual(new Set([4, 5, 6, 9]));
  });

  it('takes other margins', () => {
    expect(pagesToKeep(spans(5000), 900, none, none, 0)).toEqual(new Set([5]));
    expect(pagesToKeep(spans(5000), 900, range(0, 9), none, 0, 100)).toEqual(new Set([4, 5]));
  });

  it('keeps nothing of no pages', () => {
    expect(pagesToKeep([], 900, none, none)).toEqual(new Set());
  });
});

describe('PageWindow', () => {
  let scroll = 0;
  let hidden = false;
  let host: HTMLDivElement;
  let win: PageWindow | undefined;
  const built: [string, number][] = [];

  beforeEach(() => {
    scroll = 0;
    hidden = false;
    built.length = 0;
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      const p = this.getAttribute('data-page');
      const top = p === null || hidden ? 0 : 1000 * Number(p) - scroll;
      return new DOMRect(0, top, 1000, p === null || hidden ? 0 : 1000);
    });
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    host = document.createElement('div');
    document.body.append(host);
  });
  afterEach(() => {
    win?.dispose();
    win = undefined;
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const open = (n: number) => {
    win = new PageWindow(host, buildPageIndex(pages(n)), (page, i) => {
      built.push([page.getAttribute('data-page') ?? '', i]);
    });
    win.start();
    return win;
  };
  const slots = () => [...host.children] as SVGSVGElement[];
  const filled = () => slots().flatMap((s, i) => (s.childElementCount > 0 ? [i] : []));

  it('builds only the pages in the window', () => {
    open(10);
    expect(slots()).toHaveLength(10);
    expect(filled()).toEqual([0, 1]);
    scroll = 5000;
    win!.update();
    expect(filled()).toEqual([4, 5, 6]);
    expect(built.map(([, i]) => i)).toEqual([4, 5, 6]);
  });

  it('keeps each page where it stands: attributes, aspect ratio, node', () => {
    open(10);
    const nodes = slots();
    for (const [i, slot] of nodes.entries()) {
      expect(slot.getAttribute('viewBox')).toBe('0 0 2100 2970');
      expect(slot.style.aspectRatio).toBe('2100 / 2970');
      expect(slot.getAttribute('data-page')).toBe(String(i));
      expect(slot.getAttribute('data-first-bar')).toBe(String(i * 2));
      expect(slot.getAttribute('data-bars')).toBe('2');
    }
    scroll = 6000;
    win!.update();
    scroll = 0;
    win!.update();
    expect(slots()).toEqual(nodes);
    expect(slots().every((s, i) => s.getAttribute('data-page') === String(i))).toBe(true);
    expect(slots()[0]!.style.aspectRatio).toBe('2100 / 2970');
  });

  it('builds the page of a note when asked, once', () => {
    open(10);
    expect(slots()[7]!.childElementCount).toBe(0);
    win!.ensureNotes(['n7-1', 'n7-0', 'unknown']);
    expect(filled()).toEqual([0, 1, 7]);
    expect(built.filter(([, i]) => i === 7)).toHaveLength(1);
    expect(host.querySelector('#n7-1')).not.toBeNull();
    win!.ensureNotes(['n7-0']);
    expect(built.filter(([, i]) => i === 7)).toHaveLength(1);
  });

  it('builds the page of a bar when asked', () => {
    open(10);
    win!.ensureBar(2 * 8 + 1);
    expect(win!.isBuilt(8)).toBe(true);
    expect(win!.isBuilt(9)).toBe(false);
    win!.ensureBar(9999);
    expect(win!.isBuilt(9)).toBe(false);
  });

  it('keeps a page holding the red when it is far from the window', () => {
    open(10);
    host.querySelector('#n0-1')!.classList.add('is-red');
    scroll = 8000;
    win!.update();
    expect(filled()).toEqual([0, 7, 8, 9]);
    expect(host.querySelector('#n0-1')?.classList.contains('is-red')).toBe(true);
    host.querySelector('#n0-1')!.classList.remove('is-red');
    win!.update();
    expect(slots()[0]!.childElementCount).toBe(0);
  });

  it('builds every page for a short piece, or without an observer', () => {
    expect(WINDOW_MIN_PAGES).toBe(6);
    open(5);
    expect(filled()).toEqual([0, 1, 2, 3, 4]);
    win!.dispose();
    vi.unstubAllGlobals();
    vi.stubGlobal('IntersectionObserver', undefined);
    open(10);
    expect(filled()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('leaves the pages as they are while the sheet has no boxes (hidden for print)', () => {
    open(10);
    expect(filled()).toEqual([0, 1]);
    hidden = true;
    win!.update();
    expect(filled()).toEqual([0, 1]);
    hidden = false;
    scroll = 5000;
    win!.update();
    expect(filled()).toEqual([4, 5, 6]);
  });

  it('builds all pages when asked', () => {
    open(10);
    win!.buildAll();
    expect(filled()).toHaveLength(10);
    expect(win!.isBuilt(9)).toBe(true);
  });

  it('is found from its host until disposed', () => {
    open(10);
    expect(pageWindowOf(host)).toBe(win);
    expect(win!.index.bars).toHaveLength(10);
    win!.dispose();
    expect(pageWindowOf(host)).toBeUndefined();
  });

  it('updates once a frame after the observer calls', () => {
    const calls: (() => void)[] = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: () => void) {
          calls.push(cb);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    open(10);
    expect(calls.length).toBeGreaterThan(0);
    scroll = 5000;
    for (const cb of calls) cb();
    expect(frames).toHaveLength(1);
    expect(filled()).toEqual([0, 1]);
    frames[0]!(0);
    expect(filled()).toEqual([4, 5, 6]);
  });
});
