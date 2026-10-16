import { parseMusicXml } from '@digitus2/engine';

export const GRAPHIC_SPAN_TAGS =
  'slur, wedge, octave-shift, pedal, bracket, dashes, glissando, slide, wavy-line, tuplet, hammer-on, pull-off';
export const GRAPHIC_SPAN_WARNING =
  'Slurs and other notation spans are kept within each scanned page. Compare continuations at page edges; missing endpoints have not been repaired.';

const children = (node: Element, tag: string) =>
  Array.from(node.children).filter((child) => child.tagName === tag);
const text = (node: Element, tag: string) => children(node, tag)[0]?.textContent?.trim();
const refuse = (reason: string): never => {
  throw new Error(
    `These pages cannot be combined safely: ${reason}. Download each page for correction in a notation editor.`,
  );
};

/** Append raw measures, keeping each page's own time units and notation. Never re-engrave notes. */
export function joinScanPages(pages: readonly string[]): string {
  if (!pages.length) return refuse('no recognized pages');
  if (pages.length === 1) return pages[0]!;
  const documents = pages.map((xml) => {
    if (/<!ENTITY/i.test(xml)) return refuse('XML entities are unsupported');
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.querySelector('parsererror') || doc.documentElement.tagName !== 'score-partwise')
      return refuse('expected partwise MusicXML');
    if (
      doc.querySelector('repeat, ending, segno, coda') ||
      Array.from(doc.querySelectorAll('sound')).some((el) =>
        ['dacapo', 'dalsegno', 'tocoda', 'fine'].some((a) => el.hasAttribute(a)),
      )
    )
      return refuse('repeat or jump navigation needs manual review');
    if (doc.querySelector('transpose, staff-details, measure-style'))
      return refuse('transposition or special staff/measure attributes need manual review');
    return doc;
  });
  const layouts = documents.map((doc, pageIndex) => {
    const root = doc.documentElement;
    const parts = children(root, 'part');
    const list = children(root, 'part-list')[0];
    const entries = list ? children(list, 'score-part') : [];
    if (!parts.length || parts.length !== entries.length) return refuse('incomplete part layout');
    let count: number | undefined;
    const layout = parts.map((part, partIndex) => {
      const entry = entries[partIndex]!;
      if (part.id !== entry.id) return refuse('part order differs from the part list');
      const measures = children(part, 'measure');
      if (!measures.length || (count !== undefined && count !== measures.length))
        return refuse('parts have unequal measure counts');
      count = measures.length;
      const opening: Element[] = [];
      for (const element of Array.from(measures[0]!.children)) {
        if (['note', 'backup', 'forward'].includes(element.tagName)) break;
        if (element.tagName === 'attributes') opening.push(...Array.from(element.children));
      }
      const starting = (tag: string) => opening.filter((el) => el.tagName === tag);
      const value = (tag: string) => starting(tag).at(-1)?.textContent?.trim();
      if (
        !value('divisions') ||
        !starting('key').length ||
        !starting('time').length ||
        !starting('clef').length
      )
        return refuse(
          `page ${pageIndex + 1} needs explicit starting divisions, key, time and clefs`,
        );
      const staves = Number(value('staves') ?? 1);
      const clefs = new Set(
        starting('clef').map((clef) => Number(clef.getAttribute('number') ?? 1)),
      );
      if (
        !Number.isSafeInteger(staves) ||
        staves < 1 ||
        clefs.size !== staves ||
        [...clefs].some((staff) => !Number.isSafeInteger(staff) || staff < 1 || staff > staves)
      )
        return refuse('incomplete starting staff layout');
      if (Array.from(part.querySelectorAll('staves')).some((s) => Number(s.textContent) !== staves))
        return refuse('staff layout changes inside a page');
      const instruments = children(entry, 'score-instrument');
      const instrumentIds = new Set(instruments.map((el) => el.id));
      if (
        [...part.querySelectorAll('instrument'), ...children(entry, 'midi-instrument')].some(
          (el) => !instrumentIds.has(el.id),
        )
      )
        return refuse('instrument reference has no declaration');
      const midi = children(entry, 'midi-instrument')
        .map((el) =>
          [
            instruments.findIndex((i) => i.id === el.id),
            ...Array.from(el.children).map(
              (setting) => `${setting.tagName}:${setting.textContent?.trim()}`,
            ),
          ].join('|'),
        )
        .sort()
        .join(';');
      return { part, entry, measures, staves, instruments, midi };
    });
    return layout;
  });
  const first = layouts[0]!;
  layouts.forEach((layout) => {
    if (layout.length !== first.length) return refuse('part counts differ');
    layout.forEach((item, index) => {
      const target = first[index]!;
      if (
        text(item.entry, 'part-name') !== text(target.entry, 'part-name') ||
        item.staves !== target.staves
      )
        return refuse('part or staff layouts differ');
      if (
        item.instruments.length !== target.instruments.length ||
        item.midi !== target.midi ||
        item.instruments.some(
          (el, i) =>
            text(el, 'instrument-name') !== text(target.instruments[i]!, 'instrument-name'),
        )
      )
        return refuse('instrument layouts differ');
    });
  });

  const canonical = first.map((item) => ({
    part: item.part.id,
    instruments: item.instruments.map((i) => i.id),
  }));
  documents.forEach((doc, pageIndex) => {
    const ids = new Map<string, string>();
    const definitions = new Set<string>();
    // IDs can be repeated by score-instrument, midi-instrument and note instrument references.
    for (const element of Array.from(doc.querySelectorAll('[id]'))) {
      const old = element.id;
      if (!['part', 'midi-instrument', 'instrument'].includes(element.tagName)) {
        if (definitions.has(old)) return refuse('duplicate XML IDs inside one page');
        definitions.add(old);
      }
      if (!ids.has(old)) ids.set(old, `page${pageIndex + 1}-${old}`);
    }
    layouts[pageIndex]!.forEach((item, index) => {
      ids.set(item.part.id, `page1-${canonical[index]!.part}`);
      item.instruments.forEach((instrument, i) => {
        ids.set(instrument.id, `page1-${canonical[index]!.instruments[i]}`);
      });
    });
    for (const element of Array.from(doc.querySelectorAll('*'))) {
      if (element.hasAttribute('id')) element.setAttribute('id', ids.get(element.id)!);
      for (const attr of ['idref', 'startid', 'endid', 'instrument', 'href']) {
        const value = element.getAttribute(attr);
        if (value === null) continue;
        const raw = value.startsWith('#') ? value.slice(1) : value;
        const mapped = ids.get(raw);
        if (!mapped) return refuse('unresolved XML ID reference');
        element.setAttribute(attr, (value.startsWith('#') ? '#' : '') + mapped);
      }
    }
  });

  first.forEach((target, partIndex) => {
    let number = 0;
    const allocated = new Map<string, number>();
    layouts.forEach((layout, pageIndex) => {
      // Separate recognitions reuse span numbers. Keep their existing local endpoint relations,
      // without inventing cross-page links from coincidentally equal numbers. MusicXML permits
      // endpoints in arbitrary document order and requires number-level values in 1..16.
      const local = new Map<string, number>();
      for (const span of Array.from(layout[partIndex]!.part.querySelectorAll(GRAPHIC_SPAN_TAGS))) {
        const old = Number(span.getAttribute('number') ?? 1);
        if (!Number.isInteger(old) || old < 1 || old > 16)
          return refuse('invalid graphic span number');
        const key = `${span.tagName}:${old}`;
        let mapped = local.get(key);
        if (mapped === undefined) {
          mapped = (allocated.get(span.tagName) ?? 0) + 1;
          if (mapped > 16)
            return refuse('more than 16 page-specific numbers for one notation span type');
          allocated.set(span.tagName, mapped);
          local.set(key, mapped);
        }
        span.setAttribute('number', String(mapped));
      }
      layout[partIndex]!.measures.forEach((measure, measureIndex) => {
        measure.setAttribute('number', String(++number));
        if (pageIndex > 0 && measureIndex === 0) {
          const print =
            children(measure, 'print')[0] ?? measure.ownerDocument.createElement('print');
          print.setAttribute('new-page', 'yes');
          if (!print.parentNode) measure.insertBefore(print, measure.firstChild);
        }
        if (pageIndex > 0) target.part.appendChild(documents[0]!.importNode(measure, true));
      });
    });
  });
  const xml = new XMLSerializer().serializeToString(documents[0]!);
  // Validates combined rhythm, pitches and cross-page tie continuity without normalizing XML.
  parseMusicXml(xml, { preserveNotation: true });
  return xml;
}
