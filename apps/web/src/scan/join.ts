import { parseMusicXml } from '@digitus2/engine';
import type { Phrase } from '../i18n/messages.js';
import { PhraseError } from '../i18n/PhraseError.js';

export const GRAPHIC_SPAN_TAGS =
  'slur, wedge, octave-shift, pedal, bracket, dashes, glissando, slide, wavy-line, tuplet, hammer-on, pull-off';
export const GRAPHIC_SPAN_WARNING =
  'Slurs and other notation spans are kept within each scanned page. Compare continuations at page edges; missing endpoints have not been repaired.';

const children = (node: Element, tag: string) =>
  Array.from(node.children).filter((child) => child.tagName === tag);
const text = (node: Element, tag: string) => children(node, tag)[0]?.textContent?.trim();
const refuse = (reason: Phrase): never => {
  throw new PhraseError((t) => t.scan.join.refused(reason(t)));
};

/** Append raw measures, keeping each page's own time units and notation. Never re-engrave notes. */
export function joinScanPages(pages: readonly string[]): string {
  if (!pages.length) return refuse((t) => t.scan.join.reasons.noPages);
  if (pages.length === 1) return pages[0]!;
  const documents = pages.map((xml) => {
    if (/<!ENTITY/i.test(xml)) return refuse((t) => t.scan.join.reasons.entities);
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.querySelector('parsererror') || doc.documentElement.tagName !== 'score-partwise')
      return refuse((t) => t.scan.join.reasons.notPartwise);
    if (
      doc.querySelector('repeat, ending, segno, coda') ||
      Array.from(doc.querySelectorAll('sound')).some((el) =>
        ['dacapo', 'dalsegno', 'tocoda', 'fine'].some((a) => el.hasAttribute(a)),
      )
    )
      return refuse((t) => t.scan.join.reasons.repeats);
    if (doc.querySelector('transpose, staff-details, measure-style'))
      return refuse((t) => t.scan.join.reasons.transposition);
    return doc;
  });
  const layouts = documents.map((doc, pageIndex) => {
    const root = doc.documentElement;
    const parts = children(root, 'part');
    const list = children(root, 'part-list')[0];
    const entries = list ? children(list, 'score-part') : [];
    if (!parts.length || parts.length !== entries.length)
      return refuse((t) => t.scan.join.reasons.partLayout);
    let count: number | undefined;
    const layout = parts.map((part, partIndex) => {
      const entry = entries[partIndex]!;
      if (part.id !== entry.id) return refuse((t) => t.scan.join.reasons.partOrder);
      const measures = children(part, 'measure');
      if (!measures.length || (count !== undefined && count !== measures.length))
        return refuse((t) => t.scan.join.reasons.measureCounts);
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
        return refuse((t) => t.scan.join.reasons.startingSetup(pageIndex + 1));
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
        return refuse((t) => t.scan.join.reasons.staffLayout);
      if (Array.from(part.querySelectorAll('staves')).some((s) => Number(s.textContent) !== staves))
        return refuse((t) => t.scan.join.reasons.staffChange);
      const instruments = children(entry, 'score-instrument');
      const instrumentIds = new Set(instruments.map((el) => el.id));
      if (
        [...part.querySelectorAll('instrument'), ...children(entry, 'midi-instrument')].some(
          (el) => !instrumentIds.has(el.id),
        )
      )
        return refuse((t) => t.scan.join.reasons.instrumentUndeclared);
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
    if (layout.length !== first.length) return refuse((t) => t.scan.join.reasons.partCounts);
    layout.forEach((item, index) => {
      const target = first[index]!;
      if (
        text(item.entry, 'part-name') !== text(target.entry, 'part-name') ||
        item.staves !== target.staves
      )
        return refuse((t) => t.scan.join.reasons.layoutsDiffer);
      if (
        item.instruments.length !== target.instruments.length ||
        item.midi !== target.midi ||
        item.instruments.some(
          (el, i) =>
            text(el, 'instrument-name') !== text(target.instruments[i]!, 'instrument-name'),
        )
      )
        return refuse((t) => t.scan.join.reasons.instrumentsDiffer);
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
        if (definitions.has(old)) return refuse((t) => t.scan.join.reasons.duplicateIds);
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
        if (!mapped) return refuse((t) => t.scan.join.reasons.unresolvedId);
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
          return refuse((t) => t.scan.join.reasons.spanNumber);
        const key = `${span.tagName}:${old}`;
        let mapped = local.get(key);
        if (mapped === undefined) {
          mapped = (allocated.get(span.tagName) ?? 0) + 1;
          if (mapped > 16) return refuse((t) => t.scan.join.reasons.spanOverflow);
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
