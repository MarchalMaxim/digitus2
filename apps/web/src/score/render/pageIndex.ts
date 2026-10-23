/**
 * What the score view needs to know about a layout's pages without building them (issue 99): a
 * long piece's pages are inline SVG of 100,000 elements and more, and only the pages near the
 * screen are kept in the DOM (pageWindow.ts). One pass over each page's markup finds the page's
 * start tag (the placeholder that stands in for it), its content, how many bars it holds, which
 * page each note is on, and the notes of each staff place, which is all the cursor's seek, the
 * bar numbering and the dimming of a whole staff read from the pages as a whole.
 *
 * The pass reads the markup Verovio writes (`g.measure > g.staff > g.layer > g.note`, ids in the
 * engine's note ids, injectIds.ts) as tags, not as a tree: it builds nothing but the lists below.
 */

export interface PageIndex {
  /** Each page's outer start tag, `<svg ...>`: with `</svg>` it is the page with nothing drawn. */
  open: string[];
  /** Each page's content, between its start tag and its closing `</svg>`. */
  inner: string[];
  /** The bars (`g.measure`) of each page. */
  bars: number[];
  /** The number of each page's first bar among the bars of every page. */
  firstBar: number[];
  /** The page (0-based) of each note, by id. */
  pageOfNote: Map<string, number>;
  /**
   * The ids of the notes (`g.note`) of each staff place, across every page, in order. A staff place
   * is the staff's place among the staves of its bar (0 for the top one): the left hand's staff is
   * the same place in every bar. A note without an id is listed as ''.
   */
  staffNotes: string[][];
}

/** A tag: closing slash, name, attributes, self-closing slash. */
const TAG = /<(\/?)([A-Za-z][\w:-]*)([^>]*?)(\/?)>/g;
/** An attribute: not part of a longer name (`data-startid` is not `id`). */
const ATTRIBUTE = /(?<![\w:.-])(id|class)="([^"]*)"/g;

interface Open {
  tag: string;
  measure: boolean;
  /** The staff place of the nearest enclosing staff of a bar, -1 outside one. */
  place: number;
  /** The staves met so far inside this bar. */
  staves: number;
}

/** Indexes the markup of `pages` (each an `<svg ...>...</svg>` as the Verovio worker returns it). */
export function buildPageIndex(pages: readonly string[]): PageIndex {
  const index: PageIndex = {
    open: [],
    inner: [],
    bars: [],
    firstBar: [],
    pageOfNote: new Map(),
    staffNotes: [],
  };
  let first = 0;
  pages.forEach((markup, page) => {
    const start = markup.indexOf('<svg');
    const openEnd = start < 0 ? -1 : markup.indexOf('>', start);
    if (openEnd < 0) {
      index.open.push('<svg>');
      index.inner.push(markup);
      index.bars.push(0);
      index.firstBar.push(first);
      return;
    }
    const innerEnd = Math.max(openEnd + 1, markup.lastIndexOf('</svg>'));
    index.open.push(markup.slice(start, openEnd + 1));
    index.inner.push(markup.slice(openEnd + 1, innerEnd));
    index.firstBar.push(first);

    let bars = 0;
    const stack: Open[] = [];
    const place = () => stack[stack.length - 1]?.place ?? -1;
    const note = (id: string) => {
      if (id) index.pageOfNote.set(id, page);
      const at = place();
      if (at >= 0) (index.staffNotes[at] ??= []).push(id);
    };
    /** What a `g` is: its classes and id, read from its attributes. */
    const attributes = (text: string) => {
      let id = '';
      let classes: string[] = [];
      for (const m of text.matchAll(ATTRIBUTE)) {
        if (m[1] === 'id') id = m[2]!;
        else classes = m[2]!.split(/\s+/);
      }
      return { id, classes };
    };
    /** Opens (or, self-closed, just meets) a `g`: returns what to push, or null when closed. */
    const meet = (text: string, selfClosed: boolean): Open | null => {
      const { id, classes } = attributes(text);
      const parent = stack[stack.length - 1];
      let at = place();
      const measure = classes.includes('measure');
      if (measure) bars++;
      if (classes.includes('staff') && parent?.measure) at = parent.staves++;
      if (classes.includes('note')) note(id);
      return selfClosed ? null : { tag: 'g', measure, place: at, staves: 0 };
    };

    TAG.lastIndex = openEnd + 1;
    for (let m = TAG.exec(markup); m && m.index < innerEnd; m = TAG.exec(markup)) {
      const tag = m[2]!;
      const text = m[3]!;
      const selfClosed = m[4] === '/';
      if (m[1]) {
        let i = stack.length - 1;
        while (i >= 0 && stack[i]!.tag !== tag) i--;
        if (i >= 0) stack.length = i;
      } else if (tag === 'g') {
        const open = meet(text, selfClosed);
        if (open) stack.push(open);
      } else if (!selfClosed) {
        stack.push({ tag, measure: false, place: place(), staves: 0 });
      }
    }
    index.bars.push(bars);
    first += bars;
  });
  return index;
}

/** The page (0-based) holding bar `bar` (0-based, among the bars of every page), -1 when none. */
export function pageOfBar(index: PageIndex, bar: number): number {
  if (!(bar >= 0)) return -1;
  for (let page = index.bars.length - 1; page >= 0; page--) {
    if (bar >= index.firstBar[page]!)
      return bar < index.firstBar[page]! + index.bars[page]! ? page : -1;
  }
  return -1;
}

/**
 * The staff places whose notes are all in `mutedIds`, across every page: the hand left out of
 * one-hand practice has its whole staff dimmed, rests included (`mutedElements`, dom.ts). A place
 * with no note is never quiet.
 */
export function quietPlaces(index: PageIndex, mutedIds: ReadonlySet<string>): Set<number> {
  const quiet = new Set<number>();
  if (mutedIds.size === 0) return quiet;
  index.staffNotes.forEach((ids, place) => {
    if (ids.length > 0 && ids.every((id) => mutedIds.has(id))) quiet.add(place);
  });
  return quiet;
}
